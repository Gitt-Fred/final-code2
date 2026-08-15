# Demo CRM

A small Next.js + MongoDB + RabbitMQ demo CRM app. Creating a client publishes a message to a `clients` queue in RabbitMQ — see [docs/RABBITMQ.md](docs/RABBITMQ.md) for why and how.

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
| `PERSISTENCE` | Set to `"true"` to read/write MongoDB; unset/false serves static in-memory sample data instead |

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

## CI/CD

[.github/workflows/CICD.yml](.github/workflows/CICD.yml) runs two jobs:

- **`build-test`** — runs on every push and pull request targeting `master`: installs dependencies, builds the Docker image, and runs an end-to-end smoke test via Docker Compose.
- **`deploy`** — only runs on a `push` to `master`, never on pull requests: tags a new semantic version, pushes the image to ECR, and rolls out the update to the EKS cluster.
