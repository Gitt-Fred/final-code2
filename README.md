# Dev CRM

A small customer-relationship-management app built with **Next.js**, **MongoDB**, and **RabbitMQ**, packaged to run with a single `docker compose up`.

You can add, search, edit, and delete customers, keep notes against each one, and see news matched to their company. Whenever a customer is created, the app publishes a message to a RabbitMQ queue so other services can react to it later.

## Table of contents

- [At a glance](#at-a-glance)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Running the project](#running-the-project)
  - [Option A: Docker Compose (recommended)](#option-a-docker-compose-recommended)
  - [Option B: Next.js on your host, dependencies in Docker](#option-b-nextjs-on-your-host-dependencies-in-docker)
  - [Option C: The app image on its own](#option-c-the-app-image-on-its-own)
- [Using the app](#using-the-app)
- [API reference](#api-reference)
- [Data model](#data-model)
- [RabbitMQ](#rabbitmq)
- [Project structure](#project-structure)
- [Development](#development)
- [CI](#ci)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Further reading](#further-reading)

## At a glance

| | |
| --- | --- |
| **App** | http://localhost:3000 |
| **RabbitMQ management UI** | http://localhost:15672 |
| **MongoDB** | `localhost:27017` |
| **Start everything** | `docker compose up -d` |
| **Stop and wipe data** | `docker compose down -v` |
| **Lint** | `npm run lint` |
| **Env template** | [`.env.local.example`](.env.local.example) |

MongoDB and RabbitMQ are bound to `127.0.0.1` only, so they are reachable from your machine but not from the rest of your network. The app itself is published on all interfaces (port 3000).

## Architecture

```mermaid
flowchart LR
    Browser["Browser"] -->|"HTTP :3000"| App["Next.js app<br/>(pages + API routes)"]
    App -->|"mongoose<br/>scoped app user"| Mongo[("MongoDB<br/>clients, notes, news")]
    App -->|"amqplib<br/>best-effort publish"| Rabbit[["RabbitMQ<br/>queue: clients"]]
    Rabbit -.->|"no consumer yet"| Future["Future workers"]
```

All three services run on one Docker network (`app_network`). The app talks to the others by service name (`mongodb`, `rabbitmq`), and Compose starts it only after both report healthy.

**What happens when you add a customer:**

```mermaid
sequenceDiagram
    participant U as Browser
    participant A as Next.js API
    participant M as MongoDB
    participant R as RabbitMQ

    U->>A: POST /api/clients
    A->>A: Validate and whitelist fields
    A->>M: Insert client
    M-->>A: Saved document
    A->>R: Publish company name (best effort)
    A-->>U: 201 Created
    Note over A,R: If RabbitMQ is down, the error is logged<br/>and the request still succeeds
```

## Tech stack

Versions are what a fresh `npm install` resolves today. `next` and `eslint-config-next` are declared as `latest`, so they move whenever you reinstall.

| Layer | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (Pages Router) | 16.3 |
| UI library | React | 18.3 |
| Styling | Tailwind CSS + daisyUI | 3.4 / 2.52 |
| Accessible components | Headless UI (modals) | 1.7 |
| Icons | Heroicons (v1) | 1.0 |
| Database | MongoDB (Docker image `mongo:6.0`) via Mongoose | 6.13 |
| Message broker | RabbitMQ (Docker image `rabbitmq:3-management-alpine`) via amqplib | 0.8 |
| Logging | pino | 7.11 |
| Linting | ESLint (flat config) + `eslint-config-next` | 9.39 / 16.3 |
| Runtime | Node.js | 20 in Docker; 20.9 or newer on your host |
| Packaging | Docker (multi-stage build), Docker Compose | |

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (includes Docker Compose and Buildx). Nothing else is required to run the app.
- **Node.js 20.9 or newer**, only if you want to run `npm` commands on your host (linting, or Option B below).
- Free ports on your machine: `3000`, `27017`, `5672`, `15672`.

## Quick start

```bash
# 1. Create your local env file from the template
cp .env.local.example .env

# 2. Build and start MongoDB, RabbitMQ, and the app
docker compose up -d

# 3. Open the app
#    http://localhost:3000
```

The first run downloads the images and builds the app, so give it a couple of minutes. `docker compose ps` should show `mongodb` and `rabbitmq` as `healthy` and `nextjs_app` as `Up`.

To stop everything and delete all stored data:

```bash
docker compose down -v
```

## Configuration

Configuration is entirely through environment variables. Start from [`.env.local.example`](.env.local.example).

### Which file to use

| File | Read by | Use it for |
| --- | --- | --- |
| `.env` | Docker Compose (variable substitution in `docker-compose.yaml`) and Next.js | Running the stack with `docker compose` |
| `.env.local` | Next.js only | Running `npm run dev` on your host |

Both are gitignored, and `.dockerignore` keeps them out of the app image. The template holds throwaway development values; **never reuse them anywhere real.**

### Variable reference

| Variable | Used by | Purpose |
| --- | --- | --- |
| `MONGO_NAME` | Compose | Username of the MongoDB **root** account, created on the first boot of an empty database volume. Not used by the app. |
| `MONGO_PASS` | Compose | Password for the root account. |
| `MONGO_DB` | Compose, `mongo-init.js` | Name of the application database (`mydatabase` in the template). |
| `MONGO_APP_USERNAME` | Compose, `mongo-init.js` | Username of the scoped user the app connects as. Created with the `readWrite` role on `MONGO_DB` only. |
| `MONGO_APP_PASSWORD` | Compose, `mongo-init.js` | Password for that user. |
| `RABBITMQ_USER` | Compose | RabbitMQ login, set as the broker's default user. |
| `RABBITMQ_PASS` | Compose | RabbitMQ password. |
| `LOG_LEVEL` | App | pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). Defaults to `debug` when empty. |
| `PERSISTENCE` | App | Must be exactly `true` to use MongoDB. Any other value, or unset, puts the app in [sample-data mode](#sample-data-mode). |
| `MONGODB_URI` | App (host runs only) | Full Mongo connection string. Compose builds this itself for the container from the values above, overriding anything in `.env`. |
| `RABBITMQ_URI` | App (host runs only) | Full AMQP connection string. Compose builds this for the container too. If empty, publishing is skipped. |

Inside Docker Compose the app receives:

```text
MONGODB_URI  = mongodb://<MONGO_APP_USERNAME>:<MONGO_APP_PASSWORD>@mongodb:27017/<MONGO_DB>?authSource=<MONGO_DB>
RABBITMQ_URI = amqp://<RABBITMQ_USER>:<RABBITMQ_PASS>@rabbitmq:5672
PERSISTENCE  = true
```

### Two things that catch people out

- **Database credentials are applied once.** `mongo-init.js` only runs when MongoDB starts with an **empty** data volume. If you change `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, or `MONGO_DB` afterwards, the existing volume keeps the old user. Run `docker compose down -v` to recreate it (this deletes your data).
- **`PERSISTENCE` is compared as a string.** `false`, `0`, or an empty value all mean "off". Only the exact text `true` turns persistence on.

## Running the project

### Option A: Docker Compose (recommended)

```bash
docker compose up -d
```

Compose starts three services:

| Service | Container | Image | Host port | Notes |
| --- | --- | --- | --- | --- |
| `mongodb` | `mongodb` | `mongo:6.0` | `127.0.0.1:27017` | Data in the named volume `mongodb_data`. Runs `mongo-init.js` on first boot. Healthchecked with a `ping`. |
| `rabbitmq` | `rabbitmq` | `rabbitmq:3-management-alpine` | `127.0.0.1:5672` (AMQP), `127.0.0.1:15672` (management UI) | No volume, so queued messages are lost when the container is removed (they survive a plain restart). Healthchecked with `rabbitmq-diagnostics ping`. |
| `app` | `nextjs_app` | Built from the [`Dockerfile`](Dockerfile) | `0.0.0.0:3000` | Waits for both services above to be healthy. |

Everyday commands:

```bash
docker compose ps                     # status and health
docker compose logs -f app            # follow the app's logs
docker compose logs rabbitmq          # broker logs
docker compose up -d --build          # rebuild the app image after changing code
docker compose down                   # stop and remove containers, keep MongoDB data
docker compose down -v                # ...and delete the MongoDB volume too
```

> Code changes are **not** picked up automatically. The app runs from a production build baked into the image, so run `docker compose up -d --build` after editing anything.

**How the image is built** ([`Dockerfile`](Dockerfile)): a three-stage build on `node:20-alpine`. Stage one installs dependencies, stage two runs `npm run build` (Next.js `standalone` output, enabled in [`next.config.js`](next.config.js)), and stage three copies only the standalone server and static assets into a slim runtime image that runs as a non-root user (`nextjs`) and starts with `node server.js`.

### Option B: Next.js on your host, dependencies in Docker

Useful when you want hot reloading. Run only the databases in Docker and the app on your machine:

```bash
cp .env.local.example .env          # used by Compose
cp .env.local.example .env.local    # used by `npm run dev`
docker compose up -d mongodb rabbitmq

npm install
npm run dev
```

The app is then at http://localhost:3000. It connects through the loopback ports Compose publishes, using the `MONGODB_URI` and `RABBITMQ_URI` values from `.env.local`. If you also have the Compose `app` container running, stop it first (`docker compose stop app`) or the two will fight over port 3000.

### Option C: The app image on its own

```bash
docker build -t demo-crm .
docker run -p 3000:3000 \
  -e PERSISTENCE=true \
  -e MONGODB_URI="mongodb://app_user:example@host.docker.internal:27017/mydatabase?authSource=mydatabase" \
  -e RABBITMQ_URI="amqp://user:example@host.docker.internal:5672" \
  demo-crm
```

You must supply reachable MongoDB and RabbitMQ instances yourself. Without `PERSISTENCE=true` the container starts fine but serves [sample data](#sample-data-mode) only.

## Using the app

### Customer list (`/`)

- **Search** by name, company, or email. It is a case-insensitive substring match, applied after a short pause in typing.
- **Pagination**: 12 customers per page, newest first, with Previous / Next controls when there is more than one page.
- **Add customer**: opens a dialog. Only **name** is required. On success you get a toast and the new customer appears at the top.
- Loading skeletons, an empty state, and an error banner with a Retry button cover the not-happy paths.

### Customer page (`/clients/[id]`)

Click any card to open it.

- **Profile** with email and website links. Only `http(s)` links are made clickable.
- **Edit** and **Delete** (with a confirmation dialog). Deleting a customer also deletes their notes.
- **Notes**: add free-text notes (up to 2000 characters), newest first, and delete individual notes.
- **Latest news**: articles stored for the customer's company. See [Adding news](#adding-news).

### Theme

The sun/moon button in the header switches between light and dark. Until you choose, the app follows your operating system's setting. Your choice is remembered in the browser (`localStorage` key `theme`) and applied before first paint, so there is no flash.

### Adding news

There is no UI or API for creating news; the `news` collection is read-only from the app's point of view and is empty by default. To try the news panel, insert a document whose `company` matches a customer's company exactly (case-sensitive):

```bash
docker exec mongodb mongosh "mongodb://app_user:<MONGO_APP_PASSWORD>@localhost:27017/mydatabase" --quiet --eval '
db.news.insertOne({
  company: "Acme Inc.",
  articles: [
    { title: "Acme launches a product", description: "A short summary.", url: "https://example.com/launch" }
  ]
})'
```

On Windows PowerShell, quoting is awkward. Save the `db.news.insertOne(...)` call to a file such as `seed.js` and run:

```powershell
Get-Content seed.js | docker exec -i mongodb mongosh "mongodb://app_user:<MONGO_APP_PASSWORD>@localhost:27017/mydatabase" --quiet
```

### Sample-data mode

When `PERSISTENCE` is not exactly `true`, the app never touches MongoDB:

- `GET` routes serve two built-in sample customers (John Doe and Omri), with working search and pagination.
- Every write (`POST`, `PUT`, `DELETE`) returns `503` with `Persistence is disabled, so this action is unavailable.`
- Notes always come back empty, and no messages are published to RabbitMQ.

## API reference

Base URL: `http://localhost:3000`. All routes speak JSON. Every response has a `success` boolean; failures also carry an `error` string.

| Route | Methods | Purpose |
| --- | --- | --- |
| `/api/clients` | `GET`, `POST` | List/search customers, create a customer |
| `/api/clients/[id]` | `GET`, `PUT`, `DELETE` | Read, update, delete one customer |
| `/api/clients/[id]/notes` | `GET`, `POST` | List or add a customer's notes |
| `/api/notes/[id]` | `DELETE` | Delete one note |
| `/api/news?company=` | `GET` | Raw news documents for a company |
| `/api/hello` | `GET` | Leftover Next.js boilerplate; returns `{ "name": "John Doe" }` |

IDs are 24-character hex MongoDB ObjectIds. A malformed or unknown id returns `404`.

### `GET /api/clients`

| Query param | Default | Description |
| --- | --- | --- |
| `q` | none | Case-insensitive substring match on `name`, `company`, or `email`. Regex characters are escaped. |
| `page` | `1` | 1-based page number. |
| `limit` | `12` | Page size, clamped to 1-50. |

```bash
curl "http://localhost:3000/api/clients?q=acme&page=1&limit=5"
```

```json
{
  "success": true,
  "data": [
    {
      "_id": "6aad59afce7d87f6e30cddfc",
      "name": "Ada Lovelace",
      "company": "Analytical Engines",
      "email": "ada@engines.io",
      "website": "https://engines.io",
      "createdAt": "2026-09-18T15:31:00.000Z",
      "updatedAt": "2026-09-18T15:31:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pages": 1
}
```

Results are sorted newest first.

### `POST /api/clients`

```bash
curl -X POST http://localhost:3000/api/clients \
  -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","company":"Analytical Engines","email":"ada@engines.io","website":"engines.io"}'
```

Returns `201` with `{ "success": true, "data": { ...client } }`. Unknown fields are ignored. If `company` is set, its value is published to RabbitMQ afterwards (best effort).

### `GET /api/clients/[id]`

Returns the customer plus an `articles` array, which is every article from all `news` documents whose `company` matches the customer's.

```json
{ "success": true, "data": { "_id": "...", "name": "Ada Lovelace", "company": "Analytical Engines", "articles": [] } }
```

### `PUT /api/clients/[id]`

Partial update: send only the fields to change (`name`, `email`, `company`, `website`). Validation runs on update. Sending no recognised fields returns `400 No fields to update`. Returns the updated document.

### `DELETE /api/clients/[id]`

Deletes the customer and all of their notes. Returns `200` with `{ "success": true, "data": {} }`.

### `GET /api/clients/[id]/notes` and `POST /api/clients/[id]/notes`

```bash
curl -X POST http://localhost:3000/api/clients/<id>/notes \
  -H "Content-Type: application/json" \
  -d '{"text":"First call went well"}'
```

`GET` returns notes newest first. `POST` returns `201` with the note, or `404` if the customer does not exist.

### `DELETE /api/notes/[id]`

Returns `200` on success, `404` if the note does not exist.

### Validation rules

| Field | Rule |
| --- | --- |
| `name` | Required, trimmed, max 120 characters |
| `email` | Optional, trimmed, lowercased, must look like `a@b.c`, max 254 characters |
| `company` | Optional, trimmed, max 120 characters |
| `website` | Optional, max 2048 characters. A missing scheme is added (`engines.io` becomes `https://engines.io`); the result must start with `http://` or `https://` and contain no spaces |
| note `text` | Required, trimmed (whitespace-only is rejected), max 2000 characters |

Multiple failures are joined into one message, e.g. `{"success":false,"error":"Email is invalid, Website is invalid"}`.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` / `201` | Success / created |
| `400` | Validation failed, or `PUT` with nothing to update |
| `404` | Unknown or malformed id |
| `405` | Method not supported on that route (an `Allow` header lists the valid ones) |
| `500` | Unexpected server error (details are logged, not returned) |
| `503` | Write attempted while `PERSISTENCE` is off |

> **Windows PowerShell:** `curl` is an alias for `Invoke-WebRequest`. Use `curl.exe` and pass JSON from a file (`--data-binary "@body.json"`) to avoid quoting problems.

## Data model

Three MongoDB collections in the `MONGO_DB` database. Mongoose creates the indexes automatically when the app first connects.

**`clients`** ([`model/client.js`](model/client.js)) — timestamps enabled

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String | required |
| `email` | String | lowercased |
| `company` | String | **indexed**; the join key to `news` |
| `website` | String | normalised to include a scheme |
| `createdAt`, `updatedAt` | Date | automatic |

**`notes`** ([`model/note.js`](model/note.js)) — `createdAt` only

| Field | Type | Notes |
| --- | --- | --- |
| `client` | ObjectId → `Client` | required, **indexed** |
| `text` | String | required |
| `createdAt` | Date | automatic |

**`news`** ([`model/news.js`](model/news.js)) — read-only for the app; you populate it yourself

| Field | Type | Notes |
| --- | --- | --- |
| `company` | String | matched to `clients.company` exactly |
| `articles` | Array of `{ title, description, url }` | |

The Mongoose schema for `articles` is declared as a single nested object, but the API reads documents with `.lean()` and treats `articles` as an array, so arrays stored by hand work as shown above.

## RabbitMQ

Creating a customer with a company publishes that company name to a durable queue called **`clients`**. It is the seam where future workers (news fetching, welcome emails, CRM sync) can plug in without changing the API.

- **Message body:** the company name as a JSON string, e.g. `"Analytical Engines"` (quotes included). Messages are marked persistent.
- **Best effort:** publishing never throws. If the broker is unreachable, the customer is still saved, the failure is logged (`Failed to write message to RabbitMQ queue: ...`), and the next request retries with a fresh connection. Messages sent while the broker is down or still starting are **dropped, not buffered**.
- **No consumer exists yet**, so messages accumulate in the queue.
- **Skipped entirely** when `RABBITMQ_URI` is empty or persistence is off.

Inspecting the queue:

```bash
# Message counts
docker exec rabbitmq rabbitmqctl list_queues name messages

# Or use the management UI at http://localhost:15672
# (log in with RABBITMQ_USER / RABBITMQ_PASS, then open Queues > clients)
```

For the reasoning and the full code walk-through, see [docs/RABBITMQ.md](docs/RABBITMQ.md).

## Project structure

```text
.
├── .github/workflows/CICD.yml   CI: lint, image build, Compose smoke test
├── components/                  React components
│   ├── Layout.js                  Page shell: header, nav, theme toggle
│   ├── ClientList.js              List page: search, pagination, add dialog, card grid
│   ├── ClientForm.js              Add/edit form (used in a dialog)
│   ├── Notes.js                   Notes list and add form for one customer
│   ├── ClientNews.js              News panel on the customer page
│   ├── Avatar.js                  Initials avatar with a stable colour per name
│   ├── Modal.js                   Headless UI dialog wrapper
│   └── Toast.js                   Toast context and provider
├── docs/RABBITMQ.md             Deep dive on the RabbitMQ integration
├── lib/
│   ├── api-helpers.js             Server helpers: PERSISTENCE check, sample data, validation/error helpers
│   ├── api.js                     Browser fetch wrapper that throws on API errors
│   ├── useApi.js                  React hook for GET requests with reload
│   ├── format.js                  Initials, safe URLs, date formatting
│   ├── mong-connect.js            Cached Mongoose connection (survives hot reloads)
│   └── rabbitmq.js                Cached amqplib channel and best-effort publisher
├── model/                       Mongoose models: client, note, news
├── pages/
│   ├── _app.js                    Global styles and toast provider
│   ├── _document.js               Applies the saved theme before first paint
│   ├── index.js                   Customer list
│   ├── clients/[id].js            Customer detail
│   └── api/                       API routes (see API reference)
├── styles/globals.css           Tailwind layers
├── Dockerfile                   Multi-stage production image
├── docker-compose.yaml          mongodb + rabbitmq + app
├── mongo-init.js                Creates the scoped MongoDB app user on first boot
├── eslint.config.mjs            ESLint flat config
├── next.config.js               Enables standalone output for the Docker image
├── tailwind.config.js           Tailwind content paths and the daisyUI plugin
├── .env.local.example           Environment template
└── app.json                     Leftover PaaS manifest; nothing in this repo uses it
```

## Development

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server with hot reload on http://localhost:3000 |
| `npm run build` | Production build (the same command the Dockerfile runs) |
| `npm run lint` | ESLint over the whole repo; fails on **any** warning |

`next lint` no longer exists in Next.js 16, which is why `lint` calls ESLint directly. Rules come from `eslint-config-next/core-web-vitals`, which includes React's newer strict hook rules. Keep these in mind when writing components:

- Don't declare components inside other components.
- Don't call `setState` synchronously inside `useEffect`. Set it from an async callback, an event handler, or derive the value instead (see [`lib/useApi.js`](lib/useApi.js)).
- Use `next/link` rather than `<a>` for internal links, and escape apostrophes and quotes in JSX text.

There is currently **no automated test suite**. Verification is lint, a production build, and the CI smoke test.

### Conventions worth knowing

- **Tailwind only scans `pages/` and `components/`** ([`tailwind.config.js`](tailwind.config.js)). Put any file that contains class names in one of those folders, or its classes won't be generated.
- **Client-side data fetching** goes through [`lib/api.js`](lib/api.js) and [`lib/useApi.js`](lib/useApi.js). The old `axios` dependency was removed.
- **Server-side helpers** live in [`lib/api-helpers.js`](lib/api-helpers.js): always use `persistenceEnabled()` instead of reading `process.env.PERSISTENCE` directly, and `pickClientFields()` rather than passing `req.body` to Mongoose.
- **Adding an API route:** create a file under `pages/api/`, call `dbConnect()` only when `persistenceEnabled()`, and reuse the response helpers (`notFound`, `sendError`, `methodNotAllowed`, `persistenceDisabled`) for consistent errors.

## CI

[`.github/workflows/CICD.yml`](.github/workflows/CICD.yml) has one job, `build-test`, run on every push and pull request to `master` (and manually via `workflow_dispatch`). Newer pushes cancel in-progress runs for the same pull request.

1. **Set up Node 20** with npm caching and run `npm install`.
2. **Lint** with `npm run lint`. Any warning or error fails the build, and it runs before the slower steps.
3. **Build the Docker image** with Buildx and the GitHub Actions layer cache.
4. **Start the Compose stack** and check that `http://localhost:3000` responds (with retries).
5. On failure, dump `docker compose logs`; always tear the stack down.

**Requirements:**

- **Commit `package-lock.json`.** `setup-node`'s npm cache fails without a lockfile.
- **Repository secrets** feed the Compose stack: `MONGO_NAME`, `MONGO_PASS`, `MONGO_DB`, `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASS`, and `LOG_LEVEL`. The workflow also passes `MONGODB_URI`, `RABBITMQ_URI`, and `PERSISTENCE`, but Compose derives its own values for those. A missing secret becomes an empty variable and Compose will fail.

There is **no deploy job** at present. It was removed because the AWS account it targeted no longer exists.

## Security notes

Read these before putting this anywhere beyond your own machine.

- **There is no authentication or authorisation.** Anyone who can reach port 3000 can read, create, edit, and delete every customer and note.
- **Least privilege for MongoDB.** The app never uses the root account; it connects as a user with `readWrite` on one database. The root credentials exist only to initialise the container.
- **Databases are loopback-only.** MongoDB and RabbitMQ are published on `127.0.0.1`. Other containers on `app_network` can still reach them.
- **RabbitMQ uses a single account** with full rights on the default virtual host. There is no scoped application user for it yet.
- **No TLS.** Traffic between the browser, app, and databases is unencrypted.
- **Input handling:** writes only accept a fixed set of string fields, search input is regex-escaped, the news endpoint only accepts a plain-string `company`, and links are rendered only for `http(s)` URLs.
- **Credentials in git history.** An early commit (`608315f`) added a `.env` with default development credentials (`admin` / `password`); it was later deleted, but it is still recoverable from history. Those values are placeholders, but history has not been rewritten. Treat any credentials that ever appeared there as burned.
- Never commit real secrets. `.env`, `.env.local`, and `.env*.local` are gitignored and excluded from the Docker build context.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Compose warns `The "MONGO_NAME" variable is not set`, or MongoDB won't start | No `.env` file. Run `cp .env.local.example .env`. |
| App logs `Authentication failed`, or `mongo-init.js` seems to have been ignored | The MongoDB volume was created with different credentials. Init only runs on an empty volume: `docker compose down -v`, then `docker compose up -d`. |
| The app shows two sample customers and "Add" fails with a 503 | `PERSISTENCE` isn't exactly `true`. Check `.env` and recreate the container. |
| I changed code but nothing changed in Docker | The image is a baked production build. Use `docker compose up -d --build`. |
| `port is already allocated` on 3000, 27017, 5672, or 15672 | Another process owns the port. Stop it, or change the left-hand side of the mapping in `docker-compose.yaml`. |
| Running Option B, port 3000 is busy | The Compose `app` container is still running. `docker compose stop app`. |
| `docker` isn't recognised right after installing Docker Desktop | Open a new terminal so it picks up the updated `PATH`. |
| Nothing appears in the `clients` queue | Was a company entered? Is `rabbitmq` healthy (`docker compose ps`)? Check `docker compose logs app` for `Failed to write message to RabbitMQ queue`. Messages sent while the broker was down or starting are dropped. |
| A new customer isn't in the list | A search filter may be active, or you're on a later page. The list is newest first. |
| The news panel is empty | Nothing seeds the `news` collection, and the company must match exactly. See [Adding news](#adding-news). |
| `npm run dev` fails with a missing native/SWC binary | `node_modules` was installed on a different OS (for example inside a Linux container). Delete `node_modules` and `.next`, then run `npm install` on your host. |
| `npm run lint` fails | Run it locally and fix what it reports; CI treats warnings as failures. |
| CI fails at Setup Node with "Dependencies lock file is not found" | `package-lock.json` isn't committed. |
| Git warns `LF will be replaced by CRLF` | Harmless line-ending conversion on Windows. |

## Known limitations

- No authentication, users, roles, or ownership of customers.
- The RabbitMQ queue has no consumer, and messages are not guaranteed: publishing is best effort and drops messages when the broker is unavailable.
- RabbitMQ has no persistent volume, so queued messages don't survive `docker compose down`.
- News can't be created from the app; it must be inserted into MongoDB directly.
- Customers can't be tagged, assigned, imported, or exported, and there are no deals, tasks, or activity history beyond notes.
- Dependency versions aren't reproducible in Docker: `next` and `eslint-config-next` are `latest`, and the Dockerfile runs `npm install` from `package.json` alone without the lockfile.
- The app container has no healthcheck, and there is no TLS anywhere.
- No automated tests beyond lint, a production build, and the CI smoke check.
- `app.json` and `pages/api/hello.js` are leftovers that nothing here uses.

## Further reading

- [docs/RABBITMQ.md](docs/RABBITMQ.md): why RabbitMQ is here, what was repaired, and how the publisher works.
