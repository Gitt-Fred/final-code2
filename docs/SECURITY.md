# Security

How the app defends itself, what each control is for, how it is tested, and what it does **not** cover. Read the [production checklist](#production-checklist) before exposing this beyond your own machine.

## Contents

- [Threat model](#threat-model)
- [Roles and permissions](#roles-and-permissions)
- [Controls at a glance](#controls-at-a-glance)
- [How authentication works](#how-authentication-works)
- [Request protections](#request-protections)
- [Browser protections](#browser-protections)
- [Deployment hardening](#deployment-hardening)
- [Logging and auditing](#logging-and-auditing)
- [Production checklist](#production-checklist)
- [Testing](#testing)
- [What is not covered](#what-is-not-covered)

## Threat model

What we are protecting: customer records and notes, user accounts, and the ability to act as a user or admin.

| Who | What they might try | Main defences |
| --- | --- | --- |
| Anyone who can reach the app (unauthenticated) | Read or change data, create an account, guess passwords, find out who has an account | Every data route requires a session; setup closes after the first admin; throttled logins with identical error responses |
| A website the user visits while signed in | Make the user's browser send requests to this app (CSRF), or embed it in a frame (clickjacking) | `SameSite=Lax` cookie, `Origin`/`Referer` check, JSON-only bodies, `frame-ancestors 'none'` |
| A signed-in member acting maliciously | Delete customers, manage users, promote themselves | Server-side role checks on every route, tested |
| A stolen or leaked session cookie | Keep using the session | Idle and absolute timeouts, server-side revocation on logout, password change, disable, and reset |
| Someone who reads the database (backup leak, injection) | Recover passwords or hijack sessions | Passwords are salted scrypt hashes; only a SHA-256 of each session token is stored |
| Malicious content inside data (XSS) | Run script in a user's browser | React escapes output, links limited to `http(s)`, CSP forbids inline and third-party scripts, cookie is `HttpOnly` |
| Malicious input | NoSQL operator injection, regex abuse, oversized or malformed bodies | Type-checked inputs, field whitelisting, escaped search, body size limits |
| A vulnerable dependency | Known exploit in a library | Pinned lockfile, `npm ci`, `npm audit` in CI, Dependabot, no end-of-life libraries |

## Roles and permissions

This is a shared team workspace: every signed-in user sees every customer. Roles limit what you can *do*.

| Action | Member | Admin |
| --- | --- | --- |
| View customers, notes, news | yes | yes |
| Create and edit customers, add notes | yes | yes |
| Delete a note | own notes | any note |
| Delete a customer | no | yes |
| Create users, change roles, disable users, reset passwords | no | yes |
| Change own password | yes | yes |

Guardrails: an admin cannot change their own role or disable themselves, and the last active admin can never be demoted or disabled. Customers and notes record who created them (`createdBy`). Records that predate accounts have no author and can only have their notes deleted by an admin.

The UI hides controls a user can't use, but that is a convenience only: **every rule is enforced by the API**, and the tests call the API directly.

## Controls at a glance

Each row names the automated test that proves it (see [`tests/security.test.mjs`](../tests/security.test.mjs)).

| Control | Where | Proven by |
| --- | --- | --- |
| Every data route requires a session (401 otherwise) | `withAuth` in [`lib/auth.js`](../lib/auth.js) | "requires authentication" (one test per route) |
| First-run setup works exactly once, even under concurrent requests | [`pages/api/auth/setup.js`](../pages/api/auth/setup.js), `model/setup.js` | "lets exactly one of several simultaneous requests create the admin" |
| Passwords hashed with salted scrypt, 12-128 characters | [`lib/password.js`](../lib/password.js) | setup and change-password validation tests |
| Login errors and status are identical for unknown account, wrong password, and disabled account | [`pages/api/auth/login.js`](../pages/api/auth/login.js) | "identical response for a wrong password and an unknown account" |
| Login throttling per IP and per account, including the correct password once throttled | [`lib/rate-limit.js`](../lib/rate-limit.js) | "throttles repeated failures", "account throttling applies to real accounts too" |
| Session cookie `HttpOnly`, `SameSite=Lax`, no `Domain`, `Secure` when configured | [`lib/session.js`](../lib/session.js) | "is HttpOnly, SameSite=Lax, path-scoped, and has no Domain" |
| Logout, password change, disable, and reset revoke sessions server-side | `lib/session.js` | "logout revokes the session on the server", "disabling a user kills their live session immediately" |
| CSRF: cross-origin state changes rejected | `checkOrigin` in [`lib/security.js`](../lib/security.js) | "blocks state-changing requests from another origin" and related |
| JSON-only request bodies | `withAuth` / `withPublic` | "requires JSON bodies" |
| Role enforcement (member vs admin) | route definitions in `pages/api` | "members cannot delete customers, manage users, or escalate themselves" |
| Ownership comes from the session, never from the request | `pages/api/clients.js`, `notes.js` | "never trusts client-supplied ownership" |
| NoSQL operator injection blocked | string checks in routes | "rejects NoSQL operator payloads", "ignores query-operator injection" |
| Regex characters in search are escaped | `escapeRegex` in `lib/api-helpers.js` | "escapes regex characters in search" |
| Body size limits and clean errors, no stack traces | per-route `config` exports | "rejects an oversized body", "leaks no stack trace" |
| Open redirects prevented after login | `safeNext` in `lib/security.js` | "never redirects to another site after login" |
| Security headers and a strict CSP; no inline scripts | [`next.config.js`](../next.config.js), `public/theme-init.js` | "sets security headers", "ships no inline executable scripts" |
| No `X-Powered-By`; authenticated responses uncacheable | `next.config.js`, `withAuth` | header tests |
| Container runs read-only, non-root, no capabilities | [`docker-compose.yaml`](../docker-compose.yaml) | verified with `docker inspect` (see below) |

## How authentication works

**Passwords.** Hashed with Node's built-in `scrypt` (N=2^15, r=8, p=3, about 32 MiB per hash, following OWASP guidance) and a random 16-byte salt. The parameters are stored inside each hash (`scrypt$N$r$p$salt$hash`), so cost can be raised later without invalidating existing passwords. Comparison is constant-time. Passwords must be 12 to 128 characters, must not equal the email, and must not be an obvious one; the upper bound stops someone submitting megabytes to burn CPU. When an email isn't registered, the server still performs a full hash so timing does not reveal which accounts exist.

**Sessions.** After login the server creates 32 random bytes (base64url) and sends it as the cookie value. MongoDB stores only the SHA-256 of that token, so a leaked database does not yield usable sessions. Every login issues a new token (no session fixation). A session ends after 8 hours of inactivity or 7 days total. Sessions are deleted on logout, password change, password reset, role change, and disabling the user, and the token is checked against the database on every request, so revocation is immediate. Expired sessions are also cleaned up by a MongoDB TTL index.

**The cookie.** `crm_session`: `HttpOnly` (scripts can't read it), `SameSite=Lax`, `Path=/`, no `Domain` (so it isn't shared with subdomains), and `Secure` when `COOKIE_SECURE` is on. It defaults to on in production; Docker Compose sets it to `false` so plain `http://localhost` works. The app logs a warning at startup if production runs without it.

**Accounts.** On a fresh install the first visit goes to `/setup`, which creates the first admin and then permanently refuses. There is no default account or password. After that there is no self-signup: admins create users and hand over a generated one-time temporary password. That account must change it at first sign-in and can't use the rest of the app until it does. Admins can reset a password the same way, which also signs the user out everywhere. Email-based reset is not implemented.

**Login throttling.** Failed attempts are counted per source IP (100 per 15 minutes) and per account (10 per 15 minutes), in MongoDB so the limits are shared across app instances. Attempts are counted whether or not the account exists, so the limiter reveals nothing. Once an account is throttled even the correct password is refused until the window passes. The trade-off: someone who knows an email can throttle that person's sign-in for up to 15 minutes. That is the cost of preventing password guessing without a CAPTCHA or MFA.

## Request protections

- **CSRF.** Every `POST`, `PUT`, `PATCH`, and `DELETE` must carry an `Origin` (or `Referer`) header that matches `APP_ORIGIN`, or the request's own `Host` when `APP_ORIGIN` is unset. Browsers always send this on cross-site writes and a page on another site can't forge it. Bodies must be `application/json`, which a plain cross-site form can't send. All of this sits on top of `SameSite=Lax`.
- **Injection.** Auth inputs must be plain strings, so `{"$ne": null}` is rejected. Writes copy only a fixed list of fields from the body, so extra fields such as `role` or `createdBy` are ignored. Search input is escaped before it becomes a regular expression. Route parameters must be 24-character hex ids.
- **Size and shape.** Each route caps its request body (10 to 50 KB); oversized bodies get `413` and malformed JSON gets `400`, with no stack traces or internal detail in responses. Unexpected errors return a generic `500`; the detail goes to the server log.
- **Flooding.** A per-IP limiter (300 requests per minute) covers the whole API. It is in-memory, so it is per app instance and blunts floods rather than guaranteeing a limit. Login and setup use the shared MongoDB limiter described above.
- **Client IP.** Taken from the socket. `X-Forwarded-For` is trusted only when `TRUST_PROXY=true`, and then only its last entry (the one your own proxy added), because earlier entries are client-controlled.

## Browser protections

Sent on every response by [`next.config.js`](../next.config.js):

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` | Blocks inline and third-party scripts, plugins, and framing |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `X-Frame-Options` | `DENY` | Clickjacking (legacy browsers) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits URL leakage |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb all off | Disables unused browser features |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` | Isolates the app from other origins |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (production) | Forces HTTPS once you serve it; browsers ignore it over plain HTTP |

Notes: `style-src` allows `'unsafe-inline'` because Headless UI and Tailwind set inline styles; script execution is the part that matters and it is strict. To make `script-src 'self'` possible, the theme-restore script lives in [`public/theme-init.js`](../public/theme-init.js) rather than inline. Development mode uses a looser CSP because React's dev tooling needs `eval`. Authenticated API responses are `Cache-Control: no-store`, and server-rendered pages are already uncacheable.

React escapes all rendered text, and the only links built from stored data (a customer's website, a news article's URL) are rendered only if they start with `http://` or `https://`, which blocks `javascript:` URLs.

## Deployment hardening

- **App container** ([`docker-compose.yaml`](../docker-compose.yaml)): read-only root filesystem (with a `tmpfs` for `/tmp`), all Linux capabilities dropped, `no-new-privileges`, runs as the non-root `nextjs` user, 512 MB memory and 200 process limits, and a Docker `HEALTHCHECK` on `/api/health` (unauthenticated, returns only `{"status":"ok"}`). MongoDB and RabbitMQ keep their defaults because the official images assume them.
- **Network exposure.** MongoDB and RabbitMQ are published on `127.0.0.1` only. The app connects to MongoDB as a user with `readWrite` on one database, never as root.
- **Supply chain.** The Docker build runs `npm ci` against the committed lockfile, and versions are pinned to a major line (`next` is no longer `latest`). Mongoose was upgraded from the end-of-life 6.x to 8.x. CI runs `npm audit --omit=dev --audit-level=high`, and [Dependabot](../.github/dependabot.yml) opens weekly update PRs for npm, Docker, and GitHub Actions.
- **Secrets.** `.env` files are gitignored and excluded from the Docker build context. Session tokens, passwords, and hashes are redacted from logs. See the README's security notes about an old commit that contains placeholder credentials.

## Logging and auditing

The app logs structured JSON to stdout (view with `docker compose logs app`). Security-relevant events carry an `event` field:

| Event | When |
| --- | --- |
| `initial_admin_created` | First-run setup completes |
| `login_success` / `login_failed` / `login_rate_limited` | Sign-in outcomes (with source IP, never the password) |
| `logout` | Sign-out |
| `password_changed` / `password_change_failed` | Change-password outcomes |
| `user_created` / `user_updated` | Admin actions; includes who did it and which fields changed (never the password) |
| `Blocked cross-origin request` | The CSRF check refused a request |
| `Forbidden: admin required` | A member called an admin-only route |

There is no in-app audit log screen. Ship these logs somewhere durable if you need history.

## Production checklist

Before exposing the app to anyone but yourself:

1. **Serve it over HTTPS** through a reverse proxy, and never expose port 3000 directly. For example with [Caddy](https://caddyserver.com) (automatic certificates):
   ```text
   crm.example.com {
       reverse_proxy localhost:3000
   }
   ```
2. In `.env`, set `COOKIE_SECURE=true`, `APP_ORIGIN=https://crm.example.com`, and `TRUST_PROXY=true` (only if exactly one proxy sits in front).
3. **Use strong, unique credentials** for MongoDB and RabbitMQ (`MONGO_*`, `RABBITMQ_*`); the template values are placeholders. Rotating a database password means recreating the volume or changing it inside MongoDB.
4. **Create the admin immediately** after first start (visit `/setup`) so nobody else does.
5. **Don't publish database ports** to the network. Keep them on loopback or remove the mappings.
6. **Back up** the `mongodb_data` volume and store backups securely; the database holds customer data and password hashes.
7. Watch the logs for `login_rate_limited` and `Blocked cross-origin request`.
8. Keep dependencies current (review Dependabot PRs) and rebuild the image regularly to pick up base-image fixes.

## Testing

The security suite is black-box: it talks to a running stack over HTTP and checks behaviour, not implementation.

```bash
docker compose down -v && docker compose up -d --build   # must be a fresh install
npm run test:e2e
```

It creates the first admin through `/setup`, so it needs an empty database and refuses to run otherwise. It runs in CI on every push and pull request. Set `BASE_URL` to point it elsewhere, and `E2E_EXPECT_SECURE=true` if that deployment marks cookies `Secure`.

Two things it cannot check: whether the CSP causes errors in a real browser (open the dev-tools console while clicking around), and any behaviour that depends on a real reverse proxy.

## What is not covered

Being clear about limits is part of security.

- **No multi-factor authentication.** A stolen password is enough. TOTP or passkeys are the natural next step.
- **No email-based password reset or account recovery.** Admins reset passwords, so there is nothing to do if the only admin forgets theirs except editing the database.
- **No TLS built in.** You must terminate HTTPS in front of the app. Traffic between the app and MongoDB or RabbitMQ is unencrypted, and neither database encrypts data at rest.
- **Shared workspace.** All members can read all customers by design. There is no per-user or per-team isolation.
- **RabbitMQ uses one full-access account**, and nothing consumes the queue yet. Messages sent while the broker is down are dropped.
- **Throttling can be abused** to lock a known account out of signing in for 15 minutes (see above). The general API rate limit is per instance.
- **Origin checking depends on browser behaviour.** Non-browser clients can send any headers, but they also can't use a victim's cookie, so this only matters for browser-based attacks, which it is designed for.
- **`style-src 'unsafe-inline'`** is allowed (see above).
- **No audit UI, no session-management screen** (users can't list or revoke their own other sessions, though a password change signs out all of them).
- **No automated dependency-license or SAST scanning** beyond `npm audit` and Dependabot.
