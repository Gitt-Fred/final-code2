# RabbitMQ Integration

This document explains why RabbitMQ exists in this project, what state it was in before this repair, and exactly what changed to make it work.

## Why RabbitMQ is here

The app's core write path is client creation: `POST /api/clients` inserts a new client document into MongoDB. Alongside that, the app wants to notify some other process — a worker, a notification service, an analytics pipeline, anything — that "a new client for company X was just added," without making the API request wait on that other process or fail because of it.

A message queue is the standard tool for that kind of decoupling:

- **The API stays fast and resilient.** `POST /api/clients` only has to succeed at writing to MongoDB. Publishing to the queue is a fire-and-forget side effect — if the broker is slow, unreachable, or down, the client is still created successfully.
- **Producer and consumer don't need to know about each other.** `pages/api/clients.js` just publishes a message with the company name. Nothing in this codebase currently consumes that message — there's no worker yet — but the queue is the seam where one can be added later (e.g. "fetch news for this company," "send a welcome email," "sync to a CRM") without touching the API route at all.
- **Messages aren't lost if nothing is listening right now.** The queue is declared `durable`, and messages are published `persistent`, so they survive a broker restart and simply wait in the queue until a consumer exists to read them.

In short: RabbitMQ is the decoupling point between "a client was created" and "whatever should happen as a result," even though the "whatever" isn't built yet.

## State before this repair

`lib/rabbitmq.js` had been reduced to a stub at some point:

```js
async function writeMessageToQueue(message) {
  console.log("Writing message, but no queue (RabbitMQ) configured.");
  console.log("Message: ", message);
  return true;
}
```

No connection was made to any broker — it just logged and returned `true` as if it had succeeded. Compounding that:

- `docker-compose.yaml` passed a `RABBITMQ_URI` variable through to the app container, but **no `rabbitmq` service existed in the compose file** for that URI to point at. There was nothing to connect to even if the code had tried.
- `amqplib` (the RabbitMQ client library) was still listed in `package.json`, unused.
- `pages/api/clients.js` already called `writeMessageToQueue(req.body.company)` on every client creation — the call site was fully wired, only the implementation behind it was disconnected.

## What changed

### 1. A real broker in `docker-compose.yaml`

Added a `rabbitmq` service:

```yaml
rabbitmq:
  image: rabbitmq:3-management-alpine
  container_name: rabbitmq
  environment:
    RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
    RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASS}
  ports:
    - "127.0.0.1:5672:5672"
    - "127.0.0.1:15672:15672"
  networks:
    - app_network
  healthcheck:
    test: rabbitmq-diagnostics -q ping
    interval: 10s
    retries: 5
    start_period: 10s
    timeout: 5s
```

- **`rabbitmq:3-management-alpine`** includes the management plugin (a web UI for inspecting queues/messages) without a large image footprint.
- **Credentials** come from `RABBITMQ_USER`/`RABBITMQ_PASS` env vars rather than the image's insecure `guest`/`guest` default, matching how the `mongodb` service is already configured from `MONGO_NAME`/`MONGO_PASS`.
- **Ports are bound to `127.0.0.1` only** (loopback), not the whole network — consistent with the same fix applied to MongoDB's port earlier. Container-to-container traffic between `app` and `rabbitmq` goes over the internal `app_network` and is unaffected; this only stops the broker from being reachable from outside the host.
- **The healthcheck** (`rabbitmq-diagnostics -q ping`) mirrors the shape of MongoDB's healthcheck, so `docker compose` can report the service as genuinely ready, not just "container started."

The `app` service was updated to match:

```yaml
depends_on:
  mongodb:
    condition: service_healthy
  rabbitmq:
    condition: service_healthy
environment:
  RABBITMQ_URI: amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@rabbitmq:5672
```

The app now waits for RabbitMQ to be healthy before starting (same pattern as MongoDB), and `RABBITMQ_URI` is built from the same credentials the broker was configured with, pointing at the internal service hostname `rabbitmq` — rather than being passed through from an arbitrary host-level variable that had nothing backing it.

### 2. A real publisher in `lib/rabbitmq.js`

Rewritten to actually use `amqplib`:

```js
import amqp from 'amqplib'

const RABBITMQ_URI = process.env.RABBITMQ_URI
const QUEUE_NAME = 'clients'

let cached = global.rabbitmq
if (!cached) {
  cached = global.rabbitmq = { channel: null, promise: null }
}

function resetConnection() {
  cached.channel = null
  cached.promise = null
}

async function getChannel() {
  if (cached.channel) return cached.channel

  if (!cached.promise) {
    cached.promise = amqp.connect(RABBITMQ_URI).then(async (connection) => {
      const channel = await connection.createChannel()
      await channel.assertQueue(QUEUE_NAME, { durable: true })
      connection.on('error', resetConnection)
      connection.on('close', resetConnection)
      cached.channel = channel
      return channel
    })
  }

  return cached.promise
}

async function writeMessageToQueue(message) {
  if (!RABBITMQ_URI) {
    console.log('RABBITMQ_URI not configured, skipping queue write. Message:', message)
    return false
  }

  try {
    const channel = await getChannel()
    channel.sendToQueue(QUEUE_NAME, Buffer.from(JSON.stringify(message)), { persistent: true })
    return true
  } catch (error) {
    console.error('Failed to write message to RabbitMQ queue:', error.message)
    resetConnection()
    return false
  }
}

export default writeMessageToQueue
```

What each piece does and why:

- **Cached connection on `global`** — the exact same pattern `lib/mong-connect.js` already uses for its MongoDB connection. Next.js reloads modules on every file change in dev; without caching on `global`, every hot-reload (or every serverless invocation) would open a brand-new AMQP connection and leak the old one. The connection/channel is opened once and reused.
- **A single durable queue named `clients`** — `assertQueue(QUEUE_NAME, { durable: true })` creates the queue if it doesn't exist and marks it to survive a broker restart. Every message is sent with `persistent: true`, meaning RabbitMQ writes it to disk, not just memory — so a message published while nothing is consuming isn't lost if the broker restarts.
- **Never throws.** This is the most important behavioral change. `pages/api/clients.js` (application code, intentionally left untouched by this repair) does:

  ```js
  const client = await Client.create(req.body)
  if (req.body.company) {
    const writeToQueue = await writeMessageToQueue(req.body.company);
  }
  res.status(201).json({ success: true, data: client })
  ```

  Both calls are inside the same `try` block. If `writeMessageToQueue` were allowed to throw — say, because the broker is temporarily unreachable — the `catch` block would fire and the API would respond `400`, even though the MongoDB write on the line above had already succeeded. That would silently desync "what the client thinks happened" from "what the database actually has." Instead, `writeMessageToQueue` catches its own errors, logs them, resets the cached connection (so the *next* call retries a fresh connection instead of reusing a known-dead one), and returns `false`. Client creation always succeeds or fails based on MongoDB alone; the queue write is genuinely best-effort, matching the "fire and forget" role described above.
- **Graceful no-op when unconfigured.** If `RABBITMQ_URI` isn't set at all (e.g. running the app outside Docker Compose without a broker), it logs and returns `false` immediately rather than attempting a connection that was never going to succeed.

### 3. Credentials and CI wiring

- **`.env.local.example`** — added `RABBITMQ_USER` / `RABBITMQ_PASS` alongside the existing `RABBITMQ_URI` (the latter stays relevant for anyone running the app directly against an external broker, outside Docker Compose).
- **`.github/workflows/CICD.yml`** — added `RABBITMQ_USER`/`RABBITMQ_PASS` to both the `build-test` and `deploy` jobs' `env:` blocks (sourced from GitHub Actions secrets), and exported them in the `build-test` job's end-to-end test step, since `docker compose up` there now has to bring up a real `rabbitmq` service. **This requires `RABBITMQ_USER` and `RABBITMQ_PASS` to be added as repo secrets in GitHub** — the workflow will run without them, but the Compose E2E step would fail without valid broker credentials.
- **`README.md`** — updated to describe RabbitMQ as a working part of the stack rather than "stubbed out," documented the two new env vars, and pointed to the management UI at `http://localhost:15672` for inspecting the `clients` queue during local development.

## How the pieces fit together

```mermaid
sequenceDiagram
    participant U as Browser
    participant A as Next.js app
    participant M as MongoDB
    participant R as RabbitMQ (clients queue)

    U->>A: POST /api/clients {name, company, ...}
    A->>M: Client.create(req.body)
    M-->>A: client document saved
    A->>R: writeMessageToQueue(company)
    Note over A,R: best-effort — failure here<br/>does not fail the request
    R-->>A: ack (or logged failure, connection reset)
    A-->>U: 201 { success: true, data: client }
```

## Verifying it works

1. `docker compose up -d` — brings up MongoDB and RabbitMQ, waits for both healthchecks, then starts the app.
2. Open `http://localhost:15672` (login with `RABBITMQ_USER`/`RABBITMQ_PASS`) and watch the `clients` queue.
3. Create a client through the app's "Add Customer" form (or `POST /api/clients` directly). The `clients` queue's message count should increase by one.
4. To confirm the failure path is safe: stop the `rabbitmq` container (`docker stop rabbitmq`) and create another client. The request should still return `201` — check the app logs for `Failed to write message to RabbitMQ queue: ...` rather than a failed request.
