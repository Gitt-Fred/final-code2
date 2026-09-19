# Dev CRM

A small customer-relationship-management app built with **Next.js**, **MongoDB**, and **RabbitMQ**, packaged to run with a single `docker compose up`.

Sign in with your own account, then add, search, edit, and delete customers, keep notes and attach files (images, PDFs, Office documents) against each one, and see news matched to their company. Whenever a customer is created, the app publishes a message to a RabbitMQ queue so other services can react to it later. Access is controlled by roles (admin and member), and the app is hardened against the common web attacks; see [docs/SECURITY.md](docs/SECURITY.md).

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
- [Accounts and roles](#accounts-and-roles)
- [Using the app](#using-the-app)
- [API reference](#api-reference)
- [Data model](#data-model)
- [RabbitMQ](#rabbitmq)
- [Security](#security)
- [Project structure](#project-structure)
- [Development](#development)
- [Testing](#testing)
- [CI](#ci)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Further reading](#further-reading)

## At a glance

| | |
| --- | --- |
| **App** | http://localhost:3000 (first visit creates the admin account) |
| **RabbitMQ management UI** | http://localhost:15672 |
| **MongoDB** | `localhost:27017` |
| **Start everything** | `docker compose up -d` |
| **Stop and wipe data** | `docker compose down -v` |
| **Lint** | `npm run lint` and `npm run lint:sinks` |
| **Security tests** | `npm run test:e2e` (needs a fresh stack) |
| **Env template** | [`.env.local.example`](.env.local.example) |

MongoDB and RabbitMQ are bound to `127.0.0.1` only, so they are reachable from your machine but not from the rest of your network. The app itself is published on all interfaces (port 3000) and over plain HTTP; see the [production checklist](docs/SECURITY.md#production-checklist) before exposing it.

## Architecture

```mermaid
flowchart LR
    Browser["Browser"] -->|"HTTP :3000<br/>session cookie"| App["Next.js app<br/>(pages + API routes)"]
    App -->|"mongoose<br/>scoped app user"| Mongo[("MongoDB<br/>clients, notes, news,<br/>users, sessions,<br/>attachments (GridFS)")]
    App -->|"amqplib<br/>best-effort publish"| Rabbit[["RabbitMQ<br/>queue: clients"]]
    Rabbit -.->|"no consumer yet"| Future["Future workers"]
```

All three services run on one Docker network (`app_network`). The app talks to the others by service name (`mongodb`, `rabbitmq`), and Compose starts it only after both report healthy.

**What happens when a signed-in user adds a customer:**

```mermaid
sequenceDiagram
    participant U as Browser
    participant A as Next.js API
    participant M as MongoDB
    participant R as RabbitMQ

    U->>A: POST /api/clients (cookie + Origin header)
    A->>A: Check Origin, JSON body, rate limit
    A->>M: Look up session and user
    M-->>A: Active user
    A->>A: Validate and whitelist fields
    A->>M: Insert client (createdBy = user)
    M-->>A: Saved document
    A->>R: Publish company name (best effort)
    A-->>U: 201 Created
    Note over A,R: If RabbitMQ is down, the error is logged<br/>and the request still succeeds
```

## Tech stack

Versions are what the committed `package-lock.json` resolves to; `npm ci` installs exactly those.

| Layer | Technology | Version |
| --- | --- | --- |
| Framework | Next.js (Pages Router) | 16.3 |
| UI library | React | 18.3 |
| Styling | Tailwind CSS + daisyUI | 3.4 / 2.52 |
| Accessible components | Headless UI (modals, menus) | 1.7 |
| Icons | Heroicons (v1) | 1.0 |
| Database | MongoDB (Docker image `mongo:6.0`) via Mongoose | 8.24 |
| Message broker | RabbitMQ (Docker image `rabbitmq:3-management-alpine`) via amqplib | 0.10 |
| Authentication | Built in: Node `crypto` (scrypt), server-side sessions in MongoDB | |
| Logging | pino | 7.11 |
| Linting | ESLint (flat config) + `eslint-config-next` | 9.39 / 16.3 |
| Tests | Node's built-in test runner (`node --test`) | |
| Runtime | Node.js | 20 in Docker; 20.9 or newer on your host |
| Packaging | Docker (multi-stage build), Docker Compose | |

## Prerequisites

- [Docker Desktop](https://docs.docker.com/get-docker/) (includes Docker Compose and Buildx). Nothing else is required to run the app.
- **Node.js 20.9 or newer**, only if you want to run `npm` commands on your host (linting, tests, or Option B below).
- Free ports on your machine: `3000`, `27017`, `5672`, `15672`.

## Quick start

```bash
# 1. Create your local env file from the template
cp .env.local.example .env

# 2. Build and start MongoDB, RabbitMQ, and the app
docker compose up -d

# 3. Open http://localhost:3000
#    A fresh install redirects you to /setup: create the admin account there.
```

The first run downloads the images and builds the app, so give it a couple of minutes. `docker compose ps` should show all three services as `healthy`.

To stop everything and delete all stored data (including accounts):

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
| `LOG_LEVEL` | App | pino log level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`). Defaults to `info` when empty. |
| `COOKIE_SECURE` | App | Whether the session cookie carries the `Secure` attribute. Unset means on in production. Compose defaults it to `false` so `http://localhost` works; **set `true` once you serve HTTPS.** |
| `APP_ORIGIN` | App | Public origin(s) of the app, comma separated (for example `https://crm.example.com`). Requests that change data must come from one of these. Empty means "the request's own host". |
| `TRUST_PROXY` | App | `true` only when exactly one reverse proxy you control sits in front. It makes the app read the client IP from `X-Forwarded-For` for rate limiting. Default `false`. |
| `MAX_UPLOAD_BYTES` | App | Largest accepted file upload in bytes. Default `10485760` (10 MB). The upload panel in the browser also warns at 10 MB, so if you raise this, raise `MAX_BYTES` in `components/Attachments.js` too. Files are checked in memory, so keep it well under the container's 512 MB limit. |
| `MAX_FILES_PER_CLIENT` | App | Most files one customer can have. Default `20`. |
| `MONGODB_URI` | App (host runs only) | Full Mongo connection string. **Required by the app.** Compose builds this itself for the container from the values above, overriding anything in `.env`. |
| `RABBITMQ_URI` | App (host runs only) | Full AMQP connection string. Compose builds this for the container too. If empty, publishing is skipped. |

Inside Docker Compose the app receives:

```text
MONGODB_URI  = mongodb://<MONGO_APP_USERNAME>:<MONGO_APP_PASSWORD>@mongodb:27017/<MONGO_DB>?authSource=<MONGO_DB>
RABBITMQ_URI = amqp://<RABBITMQ_USER>:<RABBITMQ_PASS>@rabbitmq:5672
```

### Things that catch people out

- **Database credentials are applied once.** `mongo-init.js` only runs when MongoDB starts with an **empty** data volume. If you change `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, or `MONGO_DB` afterwards, the existing volume keeps the old user. Run `docker compose down -v` to recreate it (this deletes your data, accounts included).
- **The database is required.** There is no sample-data mode any more: it would have skipped authentication, so it was removed. The app refuses to start requests without `MONGODB_URI`.
- **`COOKIE_SECURE=true` needs HTTPS.** A `Secure` cookie is not stored by most browsers over plain HTTP (Chrome and Firefox make an exception for `localhost`), so sign-in would appear to succeed and then bounce you back to the login page. The cookie is also renamed `__Host-crm_session` when it is `Secure`, so switching this setting signs everyone out once.

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
| `app` | `nextjs_app` | Built from the [`Dockerfile`](Dockerfile) | `0.0.0.0:3000` | Waits for both services above to be healthy. Runs read-only, non-root, with all capabilities dropped, and has its own healthcheck (`/api/health`). |

Everyday commands:

```bash
docker compose ps                     # status and health
docker compose logs -f app            # follow the app's logs (includes security events)
docker compose logs rabbitmq          # broker logs
docker compose up -d --build          # rebuild the app image after changing code
docker compose down                   # stop and remove containers, keep MongoDB data
docker compose down -v                # ...and delete the MongoDB volume too
```

> Code changes are **not** picked up automatically. The app runs from a production build baked into the image, so run `docker compose up -d --build` after editing anything.

**How the image is built** ([`Dockerfile`](Dockerfile)): a three-stage build on `node:20-alpine`. Stage one installs dependencies with `npm ci` from the lockfile, stage two runs `npm run build` (Next.js `standalone` output, enabled in [`next.config.js`](next.config.js)), and stage three copies only the standalone server and static assets into a slim runtime image that runs as a non-root user (`nextjs`) and starts with `node server.js`.

### Option B: Next.js on your host, dependencies in Docker

Useful when you want hot reloading. Run only the databases in Docker and the app on your machine:

```bash
cp .env.local.example .env          # used by Compose
cp .env.local.example .env.local    # used by `npm run dev`
docker compose up -d mongodb rabbitmq

npm install
npm run dev
```

The app is then at http://localhost:3000. It connects through the loopback ports Compose publishes, using the `MONGODB_URI` and `RABBITMQ_URI` values from `.env.local`. If you also have the Compose `app` container running, stop it first (`docker compose stop app`) or the two will fight over port 3000. In development the session cookie is not `Secure` and the Content-Security-Policy is relaxed (React's dev tooling needs it).

### Option C: The app image on its own

```bash
docker build -t demo-crm .
docker run -p 3000:3000 \
  -e MONGODB_URI="mongodb://app_user:example@host.docker.internal:27017/mydatabase?authSource=mydatabase" \
  -e RABBITMQ_URI="amqp://user:example@host.docker.internal:5672" \
  -e COOKIE_SECURE=false \
  demo-crm
```

You must supply reachable MongoDB and RabbitMQ instances yourself. The image defaults to production mode, so `COOKIE_SECURE=false` is needed for plain HTTP.

## Accounts and roles

### First run

A fresh install has no users. Any page request redirects to **`/setup`**, where you create the administrator (name, email, password of 12 to 128 characters). That works **exactly once**; afterwards `/setup` redirects to the login page and the API answers `409`. There is no default account and no self-signup.

### Adding people

Admins open **Users** (top navigation, or the account menu), then **Add user**. The app generates a one-time temporary password and shows it once. Hand it to the person; they must choose their own password at first sign-in before they can use anything else. Admins can also change roles, disable or re-enable accounts, and reset a password (which signs the user out everywhere and issues a new temporary one).

### What each role can do

This is a shared team workspace: everyone sees every customer. Roles limit *actions*.

| Action | Member | Admin |
| --- | --- | --- |
| View customers, notes, news | yes | yes |
| Create and edit customers, add notes | yes | yes |
| Delete a note | own notes only | any note |
| Upload and download customer files | yes | yes |
| Delete a file | own uploads only | any file |
| Delete a customer | no | yes |
| Create users, change roles, disable users, reset passwords | no | yes |
| Change own password | yes | yes |

An admin can't change their own role or disable themselves, and the last active admin can't be demoted or disabled. Every rule is enforced by the API, not just hidden in the UI.

### Sessions

Signing in sets an `HttpOnly` cookie. You are signed out after 8 hours without activity or 7 days in total. Logging out, changing your password, or an admin disabling or resetting your account ends your sessions immediately on the server. Too many failed sign-ins (10 for one account, 100 from one IP, per 15 minutes) are throttled with a `429`.

### If the only admin loses their password

There is no email reset. Recover from the database: this removes **accounts** (not customers or notes) and re-opens first-run setup.

```bash
docker exec mongodb mongosh "mongodb://app_user:<MONGO_APP_PASSWORD>@localhost:27017/mydatabase" --quiet \
  --eval 'db.users.deleteMany({}); db.sessions.deleteMany({})'
```

Wait about a minute (a stale setup lock is cleared automatically after 60 seconds), then visit `/setup` and create a new admin. Every other user has to be created again. Existing customers and notes stay, though their "added by" names disappear because the accounts are gone.

## Using the app

### Customer list (`/`)

- **Search** by name, company, or email. It is a case-insensitive substring match, applied after a short pause in typing.
- **Pagination**: 12 customers per page, newest first, with Previous / Next controls when there is more than one page.
- **Add customer**: opens a dialog. Only **name** is required. On success you get a toast and the new customer appears at the top.
- Loading skeletons, an empty state, and an error banner with a Retry button cover the not-happy paths.

### Customer page (`/clients/[id]`)

Click any card to open it.

- **Profile** with email and website links (only `http(s)` links are clickable) and who added the customer.
- **Edit** for everyone, **Delete** (with a confirmation dialog) for admins only. Deleting a customer also deletes their notes and files.
- **Notes**: add free-text notes (up to 2000 characters), newest first, each showing its author. You can delete your own notes; admins can delete any.
- **Files**: drag files onto the panel or click *browse*. A progress bar shows each upload. Images show a thumbnail; every file has a download button. You can delete your own uploads; admins can delete any. See [Attachments](#attachments) for what is accepted.
- **Latest news**: articles stored for the customer's company. See [Adding news](#adding-news).

### Attachments

Accepted, up to 10 MB each and 20 per customer (both configurable):

| Kind | Types |
| --- | --- |
| Images | PNG, JPEG, GIF, WebP |
| Documents | PDF; Word, Excel, PowerPoint (`.docx`, `.xlsx`, `.pptx`); OpenDocument (`.odt`, `.ods`, `.odp`) |
| Text | `.txt`, `.csv` (UTF-8) |

The server decides what a file is from its **contents**, never from its name or what the browser claims. Anything that isn't positively identified as one of the types above is refused with *"That file type is not allowed"*. That covers scripts (`.js`, `.py`, `.sh`), executables, HTML, SVG, archives, macro-enabled Office files (`.docm`, `.xlsm`, `.pptm`), and Office files carrying a macro project or an embedded executable. The stored filename is cleaned up, and its extension always matches the real type: a PNG uploaded as `photo.pdf` is stored as `photo.png`.

Files are stored in MongoDB (GridFS), not on disk, and always download rather than open in the browser tab. Details and limits are in [docs/SECURITY.md](docs/SECURITY.md#file-attachments).

### Account (`/account`)

Reachable from the user menu in the header. Shows your details and lets you change your password (current password required). Changing it signs out all your other sessions.

### Users (`/admin/users`, admins only)

A table of everyone with role, status, and last sign-in, plus the actions described under [Accounts and roles](#accounts-and-roles).

### Theme

The sun/moon button in the header switches between light and dark. Until you choose, the app follows your operating system's setting. Your choice is remembered in the browser (`localStorage` key `theme`, which only accepts `light` or `dark`) and applied before first paint, so there is no flash.

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

## API reference

Base URL: `http://localhost:3000`. All routes speak JSON. Every response has a `success` boolean; failures also carry an `error` string.

**Every route except the [public ones](#public-routes) requires a session cookie.** State-changing requests (`POST`, `PUT`, `PATCH`, `DELETE`) must also send an `Origin` header matching the app's origin, and bodies must be `application/json` (file uploads use `application/octet-stream` instead). JSON bodies containing a `__proto__`, `constructor`, or `prototype` key are rejected with `400`. Browsers do all of this for you; for scripts and `curl`, see [Calling the API from a script](#calling-the-api-from-a-script).

| Route | Methods | Access | Purpose |
| --- | --- | --- | --- |
| `/api/auth/setup` | `GET`, `POST` | public (once) | Report whether setup is needed; create the first admin |
| `/api/auth/login` | `POST` | public | Sign in |
| `/api/auth/logout` | `POST` | public | Sign out (revokes the session) |
| `/api/auth/me` | `GET` | signed in | The current user |
| `/api/auth/change-password` | `POST` | signed in | Change own password |
| `/api/clients` | `GET`, `POST` | signed in | List/search customers, create a customer |
| `/api/clients/[id]` | `GET`, `PUT` | signed in | Read or update one customer |
| `/api/clients/[id]` | `DELETE` | **admin** | Delete a customer and its notes and files |
| `/api/clients/[id]/notes` | `GET`, `POST` | signed in | List or add a customer's notes |
| `/api/notes/[id]` | `DELETE` | author or **admin** | Delete one note |
| `/api/clients/[id]/files` | `GET`, `POST` | signed in | List a customer's files; upload one |
| `/api/files/[id]` | `GET` | signed in | Download a file |
| `/api/files/[id]` | `DELETE` | uploader or **admin** | Delete a file |
| `/api/news?company=` | `GET` | signed in | Raw news documents for a company |
| `/api/users` | `GET`, `POST` | **admin** | List users; create a user |
| `/api/users/[id]` | `PATCH` | **admin** | Change name, role, active flag, or reset the password |
| `/api/health` | `GET` | public | Liveness probe: `{ "status": "ok" }` and nothing else |
| `/api/csp-report` | `POST` | public | Receives browser Content-Security-Policy violation reports and logs them |

IDs are 24-character hex MongoDB ObjectIds. A malformed or unknown id returns `404`.

### Calling the API from a script

```bash
BASE=http://localhost:3000

# Sign in and keep the session cookie in a jar
curl -c jar.txt -X POST $BASE/api/auth/login \
  -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your password here"}'

# Reads only need the cookie
curl -b jar.txt "$BASE/api/clients?q=acme"

# Writes also need Origin and a JSON content type
curl -b jar.txt -X POST $BASE/api/clients \
  -H "Origin: $BASE" -H "Content-Type: application/json" \
  -d '{"name":"Ada Lovelace","company":"Analytical Engines","email":"ada@engines.io","website":"engines.io"}'
```

Leaving out `Origin` on a write gives `403 Cross-origin request blocked`; a wrong content type gives `415`.

Uploading and downloading a file:

```bash
# The file is the raw body; its name goes in the query string (URL-encoded)
curl -b jar.txt -X POST "$BASE/api/clients/<customer id>/files?name=contract.pdf" \
  -H "Origin: $BASE" -H "Content-Type: application/octet-stream" \
  --data-binary @contract.pdf

curl -b jar.txt -OJ "$BASE/api/files/<file id>"   # -J saves under the server's filename
```

> **Windows PowerShell:** `curl` is an alias for `Invoke-WebRequest`. Use `curl.exe` and pass JSON from a file (`--data-binary "@body.json"`) to avoid quoting problems.

### Public routes

**`GET /api/auth/setup`** returns `{ "success": true, "data": { "needsSetup": true } }` on a fresh install and `false` afterwards.

**`POST /api/auth/setup`** with `{ name, email, password }` creates the first admin, signs them in, and returns `201`. Any later call returns `409 Setup has already been completed`.

**`POST /api/auth/login`** with `{ email, password }` returns `200` with the user and a `Set-Cookie: crm_session=...` header (`__Host-crm_session` when `COOKIE_SECURE` is on). Wrong password, unknown account, and disabled account all return the same `401 Invalid email or password`. Too many attempts return `429` with a `Retry-After` header.

**`POST /api/auth/logout`** deletes the session on the server and clears the cookie.

**`POST /api/csp-report`** accepts `application/csp-report` or `application/reports+json` bodies up to 8 KB from browsers, logs a trimmed summary as `csp_violation`, and returns `204`. It is rate-limited per IP.

### Signed-in routes

**`GET /api/auth/me`** returns `{ id, email, name, role, active, mustChangePassword, lastLoginAt, createdAt }`. A user still on a temporary password gets `403` with `"code": "PASSWORD_CHANGE_REQUIRED"` from every route except this one and change-password.

**`POST /api/auth/change-password`** with `{ currentPassword, newPassword }`. Signs out all other sessions and returns a fresh cookie.

**`GET /api/clients`**

| Query param | Default | Description |
| --- | --- | --- |
| `q` | none | Case-insensitive substring match on `name`, `company`, or `email`. Regex characters are escaped. |
| `page` | `1` | 1-based page number. |
| `limit` | `12` | Page size, clamped to 1-50. |

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
      "createdBy": "6aad59a0ce7d87f6e30cdd00",
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

**`POST /api/clients`** returns `201` with `{ "success": true, "data": { ...client } }`. Unknown fields are ignored, and `createdBy` is always taken from your session, never from the request. If `company` is set, its value is published to RabbitMQ afterwards (best effort).

**`GET /api/clients/[id]`** returns the customer, an `articles` array (every article from all `news` documents whose `company` matches), and `createdBy` as `{ _id, name }` when known.

**`PUT /api/clients/[id]`** is a partial update: send only the fields to change (`name`, `email`, `company`, `website`). Validation runs on update. Sending no recognised fields returns `400 No fields to update`.

**`DELETE /api/clients/[id]`** (admin) deletes the customer and all of their notes and files.

**`GET` / `POST /api/clients/[id]/notes`**: `GET` returns notes newest first, each with `createdBy: { _id, name }`. `POST` takes `{ "text": "..." }`, returns `201`, and `404` if the customer does not exist.

**`DELETE /api/notes/[id]`**: the note's author or an admin. Anyone else gets `403`; notes that predate accounts have no author, so only an admin can delete them.

**`GET /api/clients/[id]/files`** returns the customer's files newest first: `{ _id, filename, contentType, kind, size, createdAt, createdBy: { _id, name } }`, where `kind` is `image`, `document`, or `text`.

**`POST /api/clients/[id]/files?name=<filename>`** takes the file as the raw body with `Content-Type: application/octet-stream` and returns `201` with the stored file's metadata. The type, stored filename, and extension come from the file's contents. Responses: `404` unknown customer, `400` empty file, `409` customer already has the maximum number of files, `413` too large, `415` not an allowed type (or the wrong `Content-Type`), `429` more than 30 uploads in 10 minutes, `503` the server is busy with other uploads.

**`GET /api/files/[id]`** returns the file with its detected `Content-Type`, `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, and a sandboxing `Content-Security-Policy`.

**`DELETE /api/files/[id]`**: the uploader or an admin. Anyone else gets `403`.

### Admin routes

**`GET /api/users`** lists every user (never including password hashes).

**`POST /api/users`** with `{ name, email, role }` (`role` is `member` or `admin`, default `member`) returns `201` with `{ user, temporaryPassword }`. The temporary password is 16 characters, shown only in this response, and must be changed at first sign-in. A duplicate email returns `409`.

**`PATCH /api/users/[id]`** with any of `name`, `role`, `active`, `resetPassword: true`. Role changes, disabling, and resets end the user's sessions immediately. `resetPassword` returns `{ user, temporaryPassword }`. You can't change your own role or disable yourself (`400`), and the last active admin is protected.

### Validation rules

| Field | Rule |
| --- | --- |
| customer `name` | Required, sanitized (see below), max 120 characters |
| customer `email` | Optional, invisible characters removed, lowercased, must look like `a@b.c`, max 254 characters |
| customer `company` | Optional, sanitized, max 120 characters |
| customer `website` | Optional, max 2048 characters. A missing scheme is added (`engines.io` becomes `https://engines.io`); the result must start with `http://` or `https://` and contain no spaces |
| note `text` | Required, sanitized keeping line breaks (whitespace-only is rejected), max 2000 characters |
| user `name` / `email` | Same limits as above; the email must be unique |
| password | 12 to 128 characters, not your email address, not an obviously weak one |

Multiple failures are joined into one message, e.g. `{"success":false,"error":"Email is invalid, Website is invalid"}`.

**Sanitized** means the text is saved with HTML tags and comments removed (`<b>Acme</b>` becomes `Acme`), invisible and direction-changing Unicode characters removed, and whitespace tidied. It happens silently rather than as an error, and innocent characters like `a < b` are kept. A value that was nothing but markup ends up empty, so a required field then fails with the normal "is required" error. User names and news text are sanitized the same way.

### Status codes

| Code | Meaning |
| --- | --- |
| `200` / `201` | Success / created |
| `400` | Validation failed, malformed JSON, a prototype key in the body, an empty upload, or nothing to update |
| `401` | No valid session (also a failed login) |
| `403` | Signed in but not allowed; cross-origin request blocked; or a password change is required first |
| `404` | Unknown or malformed id |
| `405` | Method not supported on that route (an `Allow` header lists the valid ones) |
| `409` | Conflict: setup already done, duplicate email, would remove the last admin, or the customer has the maximum number of files |
| `413` | Request body or upload too large |
| `415` | Body is not `application/json` (or `application/octet-stream` for uploads), or the uploaded file type is not allowed |
| `429` | Rate limited (`Retry-After` says how long to wait) |
| `500` | Unexpected server error (details are logged, not returned) |
| `503` | Too many uploads being processed at once; try again |

## Data model

MongoDB collections in the `MONGO_DB` database. Mongoose creates the indexes automatically when the app first connects.

**`clients`** ([`model/client.js`](model/client.js)) — timestamps enabled

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String | required |
| `email` | String | lowercased |
| `company` | String | **indexed**; the join key to `news` |
| `website` | String | normalised to include a scheme |
| `createdBy` | ObjectId → `User` | set from the session; absent on customers created before accounts existed |
| `createdAt`, `updatedAt` | Date | automatic |

**`notes`** ([`model/note.js`](model/note.js)) — `createdAt` only

| Field | Type | Notes |
| --- | --- | --- |
| `client` | ObjectId → `Client` | required, **indexed** |
| `text` | String | required |
| `createdBy` | ObjectId → `User` | the author; absent on older notes |
| `createdAt` | Date | automatic |

**`users`** ([`model/user.js`](model/user.js)) — timestamps enabled

| Field | Type | Notes |
| --- | --- | --- |
| `email` | String | required, **unique**, lowercased |
| `name` | String | required |
| `role` | `admin` \| `member` | default `member` |
| `passwordHash` | String | `scrypt$N$r$p$salt$hash`; never selected or serialized by default |
| `active` | Boolean | disabled users can't sign in and lose their sessions |
| `mustChangePassword` | Boolean | true for temporary passwords |
| `lastLoginAt` | Date | |

**`sessions`** ([`model/session.js`](model/session.js))

| Field | Type | Notes |
| --- | --- | --- |
| `tokenHash` | String | SHA-256 of the cookie token, **unique**. The token itself is never stored |
| `user` | ObjectId → `User` | **indexed** |
| `expiresAt` | Date | **TTL index**: MongoDB deletes the document after this time |
| `lastSeenAt`, `userAgent`, `ip` | | for the idle timeout and diagnostics |

**`attachments`** ([`model/attachment.js`](model/attachment.js)) — `createdAt` only

| Field | Type | Notes |
| --- | --- | --- |
| `client` | ObjectId → `Client` | required, **indexed** |
| `filename` | String | sanitized, extension set from the detected type |
| `contentType` | String | the detected MIME type, sent as `Content-Type` on download |
| `kind` | `image` \| `document` \| `text` | |
| `size` | Number | bytes |
| `fileId` | ObjectId | the GridFS file holding the bytes; never sent to the browser |
| `createdBy` | ObjectId → `User` | the uploader |

**`attachmentData.files` / `attachmentData.chunks`** — the GridFS bucket holding the file bytes, in 255 KB chunks. Managed through [`lib/gridfs.js`](lib/gridfs.js); don't edit it by hand.

**`ratelimits`** ([`model/rateLimit.js`](model/rateLimit.js)) — fixed-window counters (`key`, `count`, `expiresAt` with a TTL index) for login, setup, password-change, and upload throttling.

**`setups`** ([`model/setup.js`](model/setup.js)) — a single lock document that makes first-run setup atomic.

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
- **Skipped entirely** when `RABBITMQ_URI` is empty.

Inspecting the queue:

```bash
# Message counts
docker exec rabbitmq rabbitmqctl list_queues name messages

# Or use the management UI at http://localhost:15672
# (log in with RABBITMQ_USER / RABBITMQ_PASS, then open Queues > clients)
```

For the reasoning and the full code walk-through, see [docs/RABBITMQ.md](docs/RABBITMQ.md).

## Security

The full write-up, with a threat model, a control-by-control table tied to automated tests, and a production checklist, is in **[docs/SECURITY.md](docs/SECURITY.md)**. In brief:

- **Authentication:** salted scrypt passwords; random opaque session tokens (only their SHA-256 is stored); `HttpOnly`, `SameSite=Lax` cookie; idle and absolute session timeouts; real server-side logout and revocation.
- **Authorization:** admin and member roles enforced on every API route; ownership recorded from the session, never from the request.
- **Attack resistance:** CSRF protection (Origin check and JSON-only bodies), login throttling with identical error responses, NoSQL-injection, regex-injection, and prototype-pollution defences, open-redirect protection, request size limits, no stack traces in responses.
- **Content handling:** markup, control, and invisible characters stripped from everything stored; uploads typed from their bytes against an allowlist (no scripts, executables, SVG, polyglots, or macro documents); every download forced to `attachment` with `nosniff` and a sandbox CSP; ESLint rules and `npm run lint:sinks` keep HTML-parsing APIs out of the code.
- **Browser hardening:** strict Content-Security-Policy (no inline scripts or `<style>` elements, no frames), violation reporting, Trusted Types in report-only mode, `__Host-` cookie prefix over HTTPS, `nosniff`, frame denial, referrer and permissions policies, HSTS in production, no `X-Powered-By`.
- **Deployment hardening:** read-only, non-root app container with all capabilities dropped; databases on loopback only; app connects to MongoDB with a least-privilege user; lockfile-based `npm ci`, `npm audit` and Dependabot.

**Before exposing this beyond your own machine:** serve it over HTTPS, set `COOKIE_SECURE=true` and `APP_ORIGIN`, use real credentials, and read [the checklist](docs/SECURITY.md#production-checklist).

Things to know:

- **No multi-factor authentication and no email-based password reset.** See [what is not covered](docs/SECURITY.md#what-is-not-covered).
- **No TLS built in.** The app speaks plain HTTP on port 3000; put a reverse proxy in front.
- **Uploaded files are type-checked, not virus-scanned.** A genuine PDF or Office file can still carry an exploit for the program that opens it. See [what is not covered](docs/SECURITY.md#what-is-not-covered).
- **Credentials in git history.** An early commit (`608315f`) added a `.env` with default development credentials (`admin` / `password`); it was later deleted, but it is still recoverable from history. Those values are placeholders, but history has not been rewritten. Treat any credentials that ever appeared there as burned.
- Never commit real secrets. `.env`, `.env.local`, and `.env*.local` are gitignored and excluded from the Docker build context.

## Project structure

```text
.
├── .github/
│   ├── workflows/CICD.yml       CI: lint, sink check, audit, image build, Compose stack, security tests
│   └── dependabot.yml           Weekly dependency update PRs
├── components/                  React components
│   ├── Layout.js                  Page shell: header, nav, theme toggle, user menu
│   ├── AuthCard.js                Centered card for the signed-out pages
│   ├── ClientList.js              List page: search, pagination, add dialog, card grid
│   ├── ClientForm.js              Add/edit form (used in a dialog)
│   ├── Notes.js                   Notes list and add form for one customer
│   ├── Attachments.js             File upload (drag and drop, progress), list, download, delete
│   ├── ClientNews.js              News panel on the customer page
│   ├── Avatar.js                  Initials avatar with a stable colour per name
│   ├── Modal.js                   Headless UI dialog wrapper
│   └── Toast.js                   Toast context and provider
├── docs/
│   ├── SECURITY.md              Threat model, controls, checklist, limits
│   └── RABBITMQ.md              Deep dive on the RabbitMQ integration
├── lib/
│   ├── auth.js                    withAuth / withPublic route wrappers, requireUserSSR page guard
│   ├── password.js                scrypt hashing, password policy, temporary passwords
│   ├── session.js                 Session tokens, cookies, lookup and revocation
│   ├── security.js                Origin check, client IP, safe redirects, cookie settings
│   ├── rate-limit.js              MongoDB-backed and in-memory rate limiters
│   ├── sanitize.js                Text and filename sanitizer (used as Mongoose setters)
│   ├── file-type.js               Upload allowlist: identifies files from their bytes, inspects Office ZIPs
│   ├── upload.js                  Size-capped raw body reader and upload concurrency limit
│   ├── gridfs.js                  GridFS bucket for attachment bytes
│   ├── attachments.js             Attachment serialization, deletion, Content-Disposition
│   ├── logger.js                  Shared pino logger with secret redaction
│   ├── api-helpers.js             Validation, pagination, and error helpers
│   ├── api.js                     Browser fetch wrapper and upload helper (redirects to /login on 401)
│   ├── useApi.js                  React hook for GET requests with reload
│   ├── format.js                  Initials, safe URLs, date and file-size formatting
│   ├── mong-connect.js            Cached Mongoose connection (survives hot reloads)
│   └── rabbitmq.js                Cached amqplib channel and best-effort publisher
├── model/                       Mongoose models: client, note, news, user, session, rateLimit, setup, attachment
├── pages/
│   ├── _app.js                    Global styles and toast provider
│   ├── _document.js               Loads the theme script before first paint
│   ├── index.js                   Customer list
│   ├── clients/[id].js            Customer detail
│   ├── login.js, setup.js         Signed-out pages
│   ├── account.js                 Change password
│   ├── admin/users.js             User management (admins)
│   └── api/                       API routes (see API reference)
├── public/theme-init.js         Restores the saved theme (external file so the CSP can ban inline scripts)
├── scripts/check-sinks.mjs      Fails CI on innerHTML, document.write, and other HTML/code sinks
├── tests/security.test.mjs      Black-box security suite (npm run test:e2e)
├── styles/globals.css           Tailwind layers
├── Dockerfile                   Multi-stage production image with a healthcheck
├── docker-compose.yaml          mongodb + rabbitmq + hardened app
├── mongo-init.js                Creates the scoped MongoDB app user on first boot
├── eslint.config.mjs            ESLint flat config, plus XSS guard-rail rules
├── next.config.js               Standalone output, security headers, CSP and report-only Trusted Types
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
| `npm run lint:sinks` | Fails if app code uses an API that parses strings as HTML or code (`innerHTML`, `document.write`, `new Function`, ...) |
| `npm run test:e2e` | Security test suite against a running, fresh stack |

`next lint` no longer exists in Next.js 16, which is why `lint` calls ESLint directly. Rules come from `eslint-config-next/core-web-vitals`, which includes React's newer strict hook rules. Keep these in mind when writing components:

- Don't declare components inside other components.
- Don't call `setState` synchronously inside `useEffect`. Set it from an async callback, an event handler, or derive the value instead (see [`lib/useApi.js`](lib/useApi.js)).
- Use `next/link` and the router (not `window.location`) for internal navigation, and escape apostrophes and quotes in JSX text.
- `dangerouslySetInnerHTML`, `javascript:` URLs, `eval`, and `new Function` are lint **errors**. Render text through React; if you ever truly need HTML, sanitize it with DOMPurify and add a reviewed exception.

### Conventions worth knowing

- **Every API route goes through `withAuth`** (or `withPublic` for login, setup, and logout) from [`lib/auth.js`](lib/auth.js). Routes are declared per HTTP method, with an optional `role: 'admin'`:
  ```js
  export default withAuth({
    GET: { handler: list },
    DELETE: { role: 'admin', handler: remove },
  })
  ```
  The wrapper handles the method check, flood limit, CSRF check, content-type requirement (JSON unless the route sets `contentType`), prototype-key check, session lookup, and role check, and passes `{ user, ip }` to your handler. Add `export const config = { api: { bodyParser: { sizeLimit: '50kb' } } }` to cap the body.
- **Every page goes through `requireUserSSR`** in `getServerSideProps`, which redirects signed-out visitors to `/login` and passes `user` as a prop.
- **Sanitize new text fields** by adding `set: sanitizeLine` (or `sanitizeMultiline`) from [`lib/sanitize.js`](lib/sanitize.js) to the schema field, as the existing models do.
- **Never trust the request for identity or ownership.** Take the user from the handler's argument, copy body fields with `pickClientFields()` rather than passing `req.body` to Mongoose, and check that inputs are strings before using them in a query.
- **Tailwind only scans `pages/` and `components/`** ([`tailwind.config.js`](tailwind.config.js)). Put any file that contains class names in one of those folders, or its classes won't be generated.
- **Client-side data fetching** goes through [`lib/api.js`](lib/api.js) and [`lib/useApi.js`](lib/useApi.js).
- **No inline scripts.** The production CSP forbids them, so put scripts in `public/` and load them with `next/script`.
- **Log security events with the shared logger** ([`lib/logger.js`](lib/logger.js)) and never log passwords, tokens, or hashes.

## Testing

The security suite is black-box: it talks to a running stack over HTTP and checks behaviour (83 tests covering authentication, first-run setup, sessions and cookies, login throttling, CSRF, role enforcement, redirects, headers, error handling, text sanitization, prototype pollution, file uploads and downloads, and the CSP).

```bash
docker compose down -v && docker compose up -d --build   # must be a fresh install
npm run test:e2e
```

It creates the first admin through `/setup`, so it needs an empty database and fails immediately with an explanation if users already exist. Set `BASE_URL` to test another address and `E2E_EXPECT_SECURE=true` if that deployment marks cookies `Secure`. It runs in CI on every push and pull request.

The upload tests build every hostile file in memory (scripts renamed as images, executables, SVG, PNG and GIF polyglots, macro and VBA Office files, and more) and check that each one gets `415` and nothing is stored.

It cannot check whether the Content-Security-Policy causes errors in a real browser; open the dev-tools console while using the app after changing scripts or styles.

There are no unit tests for the UI. Beyond this suite, verification is lint and a production build.

## CI

[`.github/workflows/CICD.yml`](.github/workflows/CICD.yml) has one job, `build-test`, run on every push and pull request to `master` (and manually via `workflow_dispatch`). Newer pushes cancel in-progress runs for the same pull request.

1. **Set up Node 20** with npm caching and `npm ci` (exactly the lockfile).
2. **Lint** with `npm run lint`. Any warning or error fails the build.
3. **Check for unsafe DOM sinks** with `npm run lint:sinks`.
4. **Audit** production dependencies: `npm audit --omit=dev --audit-level=high`.
5. **Build the Docker image** with Buildx and the GitHub Actions layer cache.
6. **Start the Compose stack** from a clean state and wait for the app's healthcheck.
7. **Run the security tests** (`npm run test:e2e`).
8. On failure, dump `docker compose logs`; always tear the stack down.

**Requirements:**

- **`package-lock.json` must be committed.** `setup-node`'s npm cache and `npm ci` both need it.
- **Repository secrets** feed the Compose stack: `MONGO_NAME`, `MONGO_PASS`, `MONGO_DB`, `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD`, `RABBITMQ_USER`, `RABBITMQ_PASS`, and `LOG_LEVEL`. A missing secret becomes an empty variable and Compose will fail.

[Dependabot](.github/dependabot.yml) opens weekly PRs for npm, Docker, and GitHub Actions updates. There is no deploy job at present; it was removed because the AWS account it targeted no longer exists.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Compose warns `The "MONGO_NAME" variable is not set`, or MongoDB won't start | No `.env` file. Run `cp .env.local.example .env`. |
| Every page redirects to `/setup` | Fresh database with no users. Create the admin there. |
| I can't reach `/setup` any more | An admin already exists (by design). If the only admin is locked out, see [If the only admin loses their password](#if-the-only-admin-loses-their-password). |
| Sign-in succeeds but I land back on the login page | The browser dropped the cookie: `COOKIE_SECURE=true` on a plain-HTTP site. Serve HTTPS, or set `COOKIE_SECURE=false` for local use. |
| `429 Too many attempts` when signing in | Throttled after repeated failures (10 per account or 100 per IP in 15 minutes). Wait for the `Retry-After` time. |
| `403 Cross-origin request blocked` from a script or proxy | Writes must send an `Origin` header matching the app. Add `-H "Origin: http://localhost:3000"` to `curl`, or set `APP_ORIGIN` to your public URL when using a proxy or another hostname. |
| `403 You must change your password first` | The account is on a temporary password. Sign in through the browser and change it at `/account`. |
| App logs `COOKIE_SECURE is false in production` | Expected for local HTTP. For real deployments serve HTTPS and set `COOKIE_SECURE=true`. |
| App logs `Authentication failed`, or `mongo-init.js` seems to have been ignored | The MongoDB volume was created with different credentials. Init only runs on an empty volume: `docker compose down -v`, then `docker compose up -d`. |
| Requests fail with `MONGODB_URI is not set` | Running the app outside Compose without `MONGODB_URI`. Set it in `.env.local`. |
| I changed code but nothing changed in Docker | The image is a baked production build. Use `docker compose up -d --build`. |
| `port is already allocated` on 3000, 27017, 5672, or 15672 | Another process owns the port. Stop it, or change the left-hand side of the mapping in `docker-compose.yaml`. |
| Running Option B, port 3000 is busy | The Compose `app` container is still running. `docker compose stop app`. |
| `docker` isn't recognised right after installing Docker Desktop | Open a new terminal so it picks up the updated `PATH`. |
| Nothing appears in the `clients` queue | Was a company entered? Is `rabbitmq` healthy (`docker compose ps`)? Check `docker compose logs app` for `Failed to write message to RabbitMQ queue`. Messages sent while the broker was down or starting are dropped. |
| A new customer isn't in the list | A search filter may be active, or you're on a later page. The list is newest first. |
| The news panel is empty | Nothing seeds the `news` collection, and the company must match exactly. See [Adding news](#adding-news). |
| `npm run test:e2e` says it needs a fresh install | Users already exist. `docker compose down -v && docker compose up -d --build`, then run it again. |
| `npm run dev` fails with a missing native/SWC binary | `node_modules` was installed on a different OS (for example inside a Linux container). Delete `node_modules` and `.next`, then run `npm install` on your host. |
| `npm run lint` fails | Run it locally and fix what it reports; CI treats warnings as failures. |
| `'eslint' is not recognized` on Windows | `node_modules` was installed from Git Bash, which creates symlinks instead of the `.cmd` shims `cmd`/PowerShell need. Run `npm ci` from PowerShell, or run `node node_modules/eslint/bin/eslint.js .` directly. |
| `npm run lint:sinks` fails | Code uses `innerHTML`, `document.write`, or a similar API. Render the value through React instead. |
| An upload fails with *"That file type is not allowed"* | The file's contents aren't one of the [accepted types](#attachments), whatever its name says. Common causes: an SVG, a `.docm`/`.xlsm` (macros), a text file not named `.txt`/`.csv` or not UTF-8, or a password-protected Office file. |
| An upload fails with `413` | Over `MAX_UPLOAD_BYTES` (10 MB by default). |
| Words vanished from a name or note after saving | Anything written like an HTML tag (`<like this>`) is removed on save, by design. Plain `<` and `>` are kept. |
| App logs `csp_violation` | A browser blocked (or, for Trusted Types, reported) something the Content-Security-Policy forbids. After a code change, it usually means a new inline script or style; otherwise it may be an injection attempt. The log line names the directive and the blocked resource. |
| Requests to `http://localhost:3000` hang but `http://127.0.0.1:3000` works | On Windows, `localhost` resolves to IPv6 first, and Docker Desktop's IPv6 port forwarding occasionally stops answering. Use `127.0.0.1` (for the tests: `BASE_URL=http://127.0.0.1:3000`), or restart Docker Desktop. Browsers fall back to IPv4 by themselves. |
| CI fails at Setup Node or `npm ci` with a lockfile error | `package-lock.json` isn't committed, or is out of sync with `package.json`. Run `npm install` and commit the result. |
| Git warns `LF will be replaced by CRLF` | Harmless line-ending conversion on Windows. |

## Known limitations

- No multi-factor authentication, single sign-on, or email-based password reset; admins reset passwords.
- All members can see all customers (a shared workspace by design). There is no per-user or per-team isolation, tagging, assignment, import, export, deals, or tasks.
- The app speaks plain HTTP and has no TLS of its own; traffic to MongoDB and RabbitMQ is unencrypted too.
- The RabbitMQ queue has no consumer, messages are not guaranteed (publishing is best effort and drops messages when the broker is unavailable), and the broker uses a single full-access account with no persistent volume, so queued messages don't survive `docker compose down`.
- News can't be created from the app; it must be inserted into MongoDB directly.
- The general API rate limit is per app instance; only login, setup, and password-change throttling is shared through MongoDB. Repeated failed sign-ins can throttle a known account for 15 minutes.
- Inline style *attributes* are allowed (Headless UI needs them); scripts and stylesheets are strict. Trusted Types run in report-only mode until promoted.
- Uploaded files are type-checked but not virus-scanned, images are not re-encoded (metadata such as GPS location is kept), and attachments are served from the app's own origin rather than a separate domain.
- No in-app audit log or session-management screen; security events go to the container logs.
- No automated tests beyond the security suite, lint, and a production build.
- `app.json` is a leftover that nothing here uses.

## Further reading

- [docs/SECURITY.md](docs/SECURITY.md): threat model, every control and the test that proves it, production checklist, and what is not covered.
- [docs/RABBITMQ.md](docs/RABBITMQ.md): why RabbitMQ is here, what was repaired, and how the publisher works.
