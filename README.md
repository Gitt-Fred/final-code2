# Demo CRM

A small Next.js + MongoDB demo CRM app (RabbitMQ integration is currently stubbed out/unused).

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
| `RABBITMQ_URI` | Currently unused — the queue integration is stubbed out |
| `LOG_LEVEL` | pino log level |
| `PERSISTENCE` | Set to `"true"` to read/write MongoDB; unset/false serves static in-memory sample data instead |

`.env` / `.env.local` are gitignored — never commit real credentials.

## Running with Docker Compose (recommended)

```bash
docker compose up -d
```

This builds the app image, starts MongoDB, runs `mongo-init.js` to create the scoped app database user, and serves the app at http://localhost:3000.

MongoDB's port is published to `127.0.0.1:27017` only (loopback, not the whole network) — point a local GUI client (e.g. MongoDB Compass) at `localhost:27017` if you need to inspect the database directly.

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

## CI/CD

[.github/workflows/CICD.yml](.github/workflows/CICD.yml) runs two jobs:

- **`build-test`** — runs on every push and pull request targeting `master`: installs dependencies, builds the Docker image, and runs an end-to-end smoke test via Docker Compose.
- **`deploy`** — only runs on a `push` to `master`, never on pull requests: tags a new semantic version, pushes the image to ECR, and rolls out the update to the EKS cluster.
