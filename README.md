# Demo CRM

A small Next.js + MongoDB + RabbitMQ demo CRM app. Creating a client publishes a message to a `clients` queue in RabbitMQ — see [docs/RABBITMQ.md](docs/RABBITMQ.md) for why and how.

## Features

- **Customers**: add, edit, and delete customers; search by name, company, or email; paginated list.
- **Customer page** (`/clients/[id]`): profile, per-customer notes, and the latest news matched to their company.
- **UI**: Tailwind + daisyUI + Headless UI, with a light/dark theme toggle (follows your OS setting until you pick one), loading skeletons, empty and error states, and toast feedback.

### API

| Route | Methods | Notes |
| --- | --- | --- |
| `/api/clients` | `GET`, `POST` | `GET` accepts `q`, `page`, `limit` (max 50) and returns `{ data, total, page, pages }` |
| `/api/clients/[id]` | `GET`, `PUT`, `DELETE` | `GET` includes the company's news `articles`; `DELETE` also removes the customer's notes |
| `/api/clients/[id]/notes` | `GET`, `POST` | Notes are stored in their own `notes` collection |
| `/api/notes/[id]` | `DELETE` | |
| `/api/news?company=` | `GET` | |

Validation errors come back as `400 { success: false, error }`.

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) — includes Docker Compose and Buildx
- Node.js, only if you want to run the app outside of Docker

## Configuration

Copy the example env file and fill in real values for local use:

```bash
cp .env.local.example .env
```

| Variable | Purpose |
| --- | --- |
| `MONGO_NAME` / `MONGO_PASS` / `MONGO_DB` | MongoDB root credentials and database name, used only to initialize the container |
| `MONGO_APP_USERNAME` / `MONGO_APP_PASSWORD` | Scoped, least-privilege database user the app actually connects as. Created automatically by [mongo-init.js](mongo-init.js) on first boot — the app never authenticates as root |
| `MONGODB_URI` | Full Mongo connection string, used when running the app outside Docker Compose |
| `RABBITMQ_URI` | Full RabbitMQ connection string, used when running the app outside Docker Compose |
| `RABBITMQ_USER` / `RABBITMQ_PASS` | RabbitMQ broker credentials, used to configure the `rabbitmq` container |
| `LOG_LEVEL` | pino log level |
| `PERSISTENCE` | Set to exactly `true` to read/write MongoDB. Any other value (or unset) serves read-only sample data and rejects writes with a 503 |

`.env` / `.env.local` are gitignored — never commit real credentials.

## Running with Docker Compose (recommended)

```bash
docker compose up -d
```

This builds the app image, starts MongoDB and RabbitMQ, runs `mongo-init.js` to create the scoped app database user, and serves the app at http://localhost:3000.

Both MongoDB's and RabbitMQ's ports are published to loopback only (`127.0.0.1:27017` and `127.0.0.1:5672`/`127.0.0.1:15672`), not the whole network. Use a local GUI client (e.g. MongoDB Compass) at `localhost:27017` to inspect the database, or the RabbitMQ management UI at [http://localhost:15672](http://localhost:15672) (login with `RABBITMQ_USER`/`RABBITMQ_PASS`) to inspect the `clients` queue.

Tear down with:

```bash
docker compose down -v
```

## Running locally without Docker

```bash
npm install
npm run dev
```

## Building the Docker image directly

```bash
docker build -t demo-crm .
docker run -p 3000:3000 demo-crm
```

## Linting

```bash
npm run lint
```

Runs ESLint (flat config in [eslint.config.mjs](eslint.config.mjs), based on `eslint-config-next/core-web-vitals`) and fails on any warning. Note that `next lint` no longer exists in Next.js 16, so this calls ESLint directly.

## CI

[.github/workflows/CICD.yml](.github/workflows/CICD.yml) has a single `build-test` job, run on every push and pull request targeting `master`:

1. Installs dependencies and runs `npm run lint` (fails the build on any lint warning or error).
2. Builds the Docker image with layer caching.
3. Starts the Compose stack and smoke-tests `http://localhost:3000`.

There is currently no deploy job.
