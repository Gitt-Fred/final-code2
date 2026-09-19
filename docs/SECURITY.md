# Security

How the app defends itself, what each control is for, how it is tested, and what it does **not** cover. Read the [production checklist](#production-checklist) before exposing this beyond your own machine.

## Contents

- [Threat model](#threat-model)
- [Roles and permissions](#roles-and-permissions)
- [Controls at a glance](#controls-at-a-glance)
- [How authentication works](#how-authentication-works)
- [Request protections](#request-protections)
- [Content handling](#content-handling)
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
| Malicious content inside data (XSS) | Run script in a user's browser | Markup stripped on save, React escapes output, links limited to `http(s)`, CSP forbids inline and third-party scripts and stylesheets, lint gates block HTML sinks, cookie is `HttpOnly` |
| A signed-in user uploading a hostile file | Store a script, executable, HTML/SVG page, polyglot, or macro document and get it run by a colleague or the browser | Type proven from the bytes against an allowlist, macro and embedded-executable checks on Office files, extension derived from the detected type, every download forced to `attachment` with `nosniff` and a sandbox CSP |
| Malicious input | NoSQL operator injection, prototype pollution, regex abuse, oversized or malformed bodies | Type-checked inputs, field whitelisting, `__proto__`/`constructor`/`prototype` keys rejected, escaped search, body size limits |
| A vulnerable dependency | Known exploit in a library | Pinned lockfile, `npm ci`, `npm audit` in CI, Dependabot, no end-of-life libraries |

## Roles and permissions

This is a shared team workspace: every signed-in user sees every customer. Roles limit what you can *do*.

| Action | Member | Admin |
| --- | --- | --- |
| View customers, notes, news | yes | yes |
| Create and edit customers, add notes | yes | yes |
| Delete a note | own notes | any note |
| Upload and download customer files | yes | yes |
| Delete a file | own uploads | any file |
| Delete a customer | no | yes |
| Create users, change roles, disable users, reset passwords | no | yes |
| Change own password | yes | yes |

Guardrails: an admin cannot change their own role or disable themselves, and the last active admin can never be demoted or disabled. Customers, notes, and files record who created them (`createdBy`). Records that predate accounts have no author and can only have their notes deleted by an admin.

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
| Injected stylesheets and frames blocked; CSP violations reported; Trusted Types in report-only | `next.config.js`, [`pages/api/csp-report.js`](../pages/api/csp-report.js) | "forbids injected stylesheets, frames, and plugins", "ships no inline <style> elements", "accepts violation reports" |
| Markup, control, bidi, and zero-width characters stripped from stored text | [`lib/sanitize.js`](../lib/sanitize.js), as Mongoose setters in `model/` | the "text sanitization" tests |
| Prototype-pollution keys rejected in JSON bodies | `hasForbiddenKeys` in `lib/security.js` | "rejects JSON bodies carrying prototype-pollution keys" |
| Uploads typed from their bytes; scripts, executables, SVG, polyglots, and macro documents rejected | [`lib/file-type.js`](../lib/file-type.js) | "rejects scripts, executables, markup, and macro documents" |
| Upload size cap, octet-stream only, same CSRF and auth checks | [`lib/upload.js`](../lib/upload.js), `pages/api/clients/[id]/files.js` | "refuses oversized and empty uploads", "upload keeps the CSRF, content-type, and auth checks" |
| Downloads always `attachment`, detected type, `nosniff`, sandbox CSP | `pages/api/files/[id].js` | "serves files as downloads with the detected type" |
| File deletion by uploader or admin; customer delete removes their files | `pages/api/files/[id].js`, [`lib/attachments.js`](../lib/attachments.js) | "file deletion: uploaders and admins only", "deleting a customer deletes their files" |
| No HTML or code-evaluating sinks in app code | `eslint.config.mjs`, [`scripts/check-sinks.mjs`](../scripts/check-sinks.mjs) | `npm run lint` and `npm run lint:sinks` in CI |
| No `X-Powered-By`; authenticated responses uncacheable | `next.config.js`, `withAuth` | header tests |
| Container runs read-only, non-root, no capabilities | [`docker-compose.yaml`](../docker-compose.yaml) | verified with `docker inspect` (see below) |

## How authentication works

**Passwords.** Hashed with Node's built-in `scrypt` (N=2^15, r=8, p=3, about 32 MiB per hash, following OWASP guidance) and a random 16-byte salt. The parameters are stored inside each hash (`scrypt$N$r$p$salt$hash`), so cost can be raised later without invalidating existing passwords. Comparison is constant-time. Passwords must be 12 to 128 characters, must not equal the email, and must not be an obvious one; the upper bound stops someone submitting megabytes to burn CPU. When an email isn't registered, the server still performs a full hash so timing does not reveal which accounts exist.

**Sessions.** After login the server creates 32 random bytes (base64url) and sends it as the cookie value. MongoDB stores only the SHA-256 of that token, so a leaked database does not yield usable sessions. Every login issues a new token (no session fixation). A session ends after 8 hours of inactivity or 7 days total. Sessions are deleted on logout, password change, password reset, role change, and disabling the user, and the token is checked against the database on every request, so revocation is immediate. Expired sessions are also cleaned up by a MongoDB TTL index.

**The cookie.** `crm_session` (named `__Host-crm_session` whenever it is `Secure`; browsers then refuse the cookie unless it is `Secure`, has `Path=/`, and has no `Domain`, so a subdomain or a plain-HTTP response can never plant or overwrite it): `HttpOnly` (scripts can't read it), `SameSite=Lax`, `Path=/`, no `Domain` (so it isn't shared with subdomains), and `Secure` when `COOKIE_SECURE` is on. It defaults to on in production; Docker Compose sets it to `false` so plain `http://localhost` works. The app logs a warning at startup if production runs without it.

**Accounts.** On a fresh install the first visit goes to `/setup`, which creates the first admin and then permanently refuses. There is no default account or password. After that there is no self-signup: admins create users and hand over a generated one-time temporary password. That account must change it at first sign-in and can't use the rest of the app until it does. Admins can reset a password the same way, which also signs the user out everywhere. Email-based reset is not implemented.

**Login throttling.** Failed attempts are counted per source IP (100 per 15 minutes) and per account (10 per 15 minutes), in MongoDB so the limits are shared across app instances. Attempts are counted whether or not the account exists, so the limiter reveals nothing. Once an account is throttled even the correct password is refused until the window passes. The trade-off: someone who knows an email can throttle that person's sign-in for up to 15 minutes. That is the cost of preventing password guessing without a CAPTCHA or MFA.

## Request protections

- **CSRF.** Every `POST`, `PUT`, `PATCH`, and `DELETE` must carry an `Origin` (or `Referer`) header that matches `APP_ORIGIN`, or the request's own `Host` when `APP_ORIGIN` is unset. Browsers always send this on cross-site writes and a page on another site can't forge it. Bodies must be `application/json` (the upload route requires `application/octet-stream` instead), and a plain cross-site form can send neither. All of this sits on top of `SameSite=Lax`.
- **Injection.** Auth inputs must be plain strings, so `{"$ne": null}` is rejected. Writes copy only a fixed list of fields from the body, so extra fields such as `role` or `createdBy` are ignored. Search input is escaped before it becomes a regular expression. Route parameters must be 24-character hex ids. JSON bodies containing a `__proto__`, `constructor`, or `prototype` key at any depth are rejected with `400`, so a body can never reach `Object.prototype` through a later merge or spread.
- **Size and shape.** Each route caps its request body (10 to 50 KB); oversized bodies get `413` and malformed JSON gets `400`, with no stack traces or internal detail in responses. Unexpected errors return a generic `500`; the detail goes to the server log.
- **Flooding.** A per-IP limiter (300 requests per minute) covers the whole API. It is in-memory, so it is per app instance and blunts floods rather than guaranteeing a limit. Login and setup use the shared MongoDB limiter described above.
- **Client IP.** Taken from the socket. `X-Forwarded-For` is trusted only when `TRUST_PROXY=true`, and then only its last entry (the one your own proxy added), because earlier entries are client-controlled.

## Content handling

### Text

Every stored text field passes through [`lib/sanitize.js`](../lib/sanitize.js). It runs as a Mongoose setter on the schema (customer name and company, note text, user name, news titles and descriptions), not in the route handlers, so no write path can skip it. In order it:

1. Normalizes Unicode to NFC.
2. Removes control characters (notes keep line breaks and tabs).
3. Removes bidi overrides and isolates (`U+202A-202E`, `U+2066-2069`), zero-width characters, and the byte-order mark. These can make text display differently from what it contains ("Trojan Source").
4. Strips anything a browser would parse as a tag, comment, or doctype (`<` followed directly by a letter, `/`, `!`, or `?`), repeating until nothing changes so `<scr<b>ipt>` cannot reassemble. Innocent text such as `a < b and c > d` is left alone.
5. Collapses whitespace in single-line fields and trims.

It strips silently rather than rejecting. A field that was nothing but markup ends up empty and fails normal validation. Emails and website URLs only have control and invisible characters removed, then their own format validation applies.

**This is defence in depth, not the XSS defence.** The real protections are that React escapes everything it renders, that the CSP stops injected script from running, and that the lint gates below keep it that way. Sanitizing on input keeps markup out of the database, where a future CSV export, email template, or PDF (none of which escape like React does) could trip on it.

### Keeping it true: lint gates

`dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, and `new Function` are how XSS gets back into a React app. None are used, and CI makes sure it stays that way:

- ESLint treats `react/no-danger`, `react/no-danger-with-children`, `react/jsx-no-script-url`, `no-script-url`, `no-eval`, `no-implied-eval`, and `no-new-func` as errors.
- `npm run lint:sinks` ([`scripts/check-sinks.mjs`](../scripts/check-sinks.mjs)) fails the build on raw DOM sinks ESLint has no rule for (`innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `srcdoc`, `createContextualFragment`, string timers).

If you ever genuinely need to render HTML, add a vetted sanitizer (DOMPurify) and an explicit, reviewed exception. Don't just remove the rule.

### File attachments

Customers can have files attached (up to `MAX_FILES_PER_CLIENT`, default 20, each up to `MAX_UPLOAD_BYTES`, default 10 MB).

**What the server accepts is decided by the bytes, never by the name or the browser's claimed type.** [`lib/file-type.js`](../lib/file-type.js) is an allowlist:

| Type | How it is proven |
| --- | --- |
| PNG, JPEG, GIF, WebP | Magic bytes at the start of the file, and no HTML, SVG, or PHP markup anywhere in it (a "polyglot" is a valid image that is also a web page) |
| PDF | `%PDF-` at the start of the file |
| Word, Excel, PowerPoint (`.docx`, `.xlsx`, `.pptx`) | A ZIP whose `[Content_Types].xml` declares exactly one non-macro main document part. Rejected if any content type is `macroEnabled` (`.docm`, `.xlsm`, `.pptm`), if it contains `vbaProject.bin`, or if it contains an executable or script entry. Encrypted and ZIP64 archives are rejected. The manifest is inflated with a 1 MB cap, so a zip bomb can't exhaust memory. |
| OpenDocument (`.odt`, `.ods`, `.odp`) | A ZIP whose first entry is an uncompressed `mimetype` naming one of those three types. Rejected if it contains `Basic/` or `Scripts/` (macros) or an executable entry. |
| Plain text, CSV | Only when named `.txt` or `.csv` (text has no signature): valid UTF-8, no control characters, no leading `#!`, and no HTML markup |

Everything else is rejected with `415`: scripts, executables (`MZ`, ELF), HTML, **SVG** (it is XML that can carry `<script>`, the classic way past an "images only" filter), plain ZIPs, and anything unrecognized. It is rejected because it matches nothing on the list, not because it appears on a blocklist.

**Filenames.** The stored name is sanitized (directory parts, markup, control and bidi characters removed, 120 characters max) and **its extension comes from the detected type**. `../../etc/passwd.txt` is stored as `passwd.txt`, and `invoice.pdf` that is really a PNG is stored as `invoice.png`.

**Transport.** An upload is the raw request body with `Content-Type: application/octet-stream` and the name in the query string. Unlike `multipart/form-data`, a cross-site HTML form cannot send that content type, so the transport itself is a second CSRF control on top of the `Origin` check. It also means there is no multipart parser to attack. A declared `Content-Length` over the limit is refused before reading, and a body that grows past it stops being kept. Only four uploads are processed at once per app instance (`503` beyond that), and each user can make 30 uploads per 10 minutes, because files are checked in memory and the container has a fixed memory limit.

**Storage.** Bytes go into MongoDB GridFS (`attachmentData.files` and `attachmentData.chunks`), with metadata in the `attachments` collection. The app container keeps its read-only filesystem, and there is no disk path to traverse. Deleting a customer deletes their files, bytes first, so a failure part-way never leaves unreachable chunks.

**Downloads** (`GET /api/files/:id`) set every header from what was detected at upload time:

- `Content-Type`: the detected type.
- `Content-Disposition: attachment` for **every** file, images included. Navigating to a file downloads it rather than rendering it in our origin. `<img src>` ignores this header, so image thumbnails still display.
- `X-Content-Type-Options: nosniff`, so the browser never second-guesses the type.
- `Content-Security-Policy: default-src 'none'; sandbox` on the file response itself. Even if a file were somehow rendered as a document, it could run no script, would have no access to our origin, and could load nothing.

Files are only served to signed-in users. Anyone signed in can upload and download; only the uploader or an admin can delete.

## Browser protections

Sent on every response by [`next.config.js`](../next.config.js):

| Header | Value | Purpose |
| --- | --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; report-uri /api/csp-report` | Blocks inline and third-party scripts, injected stylesheets, plugins, frames, and being framed; reports violations |
| `Content-Security-Policy-Report-Only` | `require-trusted-types-for 'script'; trusted-types nextjs; report-uri /api/csp-report` (production) | Reports any string that reaches an HTML or script sink (see Trusted Types below) |
| `X-Content-Type-Options` | `nosniff` | No MIME sniffing |
| `X-Frame-Options` | `DENY` | Clickjacking (legacy browsers) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limits URL leakage |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb all off | Disables unused browser features |
| `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy` | `same-origin` | Isolates the app from other origins |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` (production) | Forces HTTPS once you serve it; browsers ignore it over plain HTTP |

Notes: stylesheets and `<style>` elements must come from our own origin (`style-src-elem 'self'`), so injected CSS can't be used to exfiltrate data or restyle the page. Only inline style *attributes* are allowed (`style-src-attr 'unsafe-inline'`), because Headless UI transitions set them. The plain `style-src` line is a fallback for older browsers that don't understand the split. Script execution is the part that matters most, and it is strict. To make `script-src 'self'` possible, the theme-restore script lives in [`public/theme-init.js`](../public/theme-init.js) rather than inline. Development mode uses a looser CSP because React's dev tooling needs `eval`. Authenticated API responses are `Cache-Control: no-store`, and server-rendered pages are already uncacheable.

React escapes all rendered text, and the only links built from stored data (a customer's website, a news article's URL) are rendered only if they start with `http://` or `https://`, which blocks `javascript:` URLs. `public/theme-init.js` only applies the two known theme names, so nothing from `localStorage` is written into the DOM unchecked.

**Violation reports.** Browsers POST CSP violations to [`/api/csp-report`](../pages/api/csp-report.js), which logs them as `csp_violation`. The endpoint is public, because browsers send reports without cookies and sometimes without an `Origin` header. It only ever writes a trimmed log line, and it is rate-limited per IP and capped at 8 KB. A burst of `csp_violation` lines is how you'd notice someone probing for XSS, or a deploy that broke the policy.

**Trusted Types** make the browser refuse to pass plain strings to sinks like `innerHTML` or `script.src` unless they come through a named, vetted policy. That stops DOM XSS even if a sink slips past the lint gates. Next's runtime creates one policy, `nextjs`, which is allowed. It is **report-only** for now: nothing is blocked, but any violation is reported. To enforce it, watch `csp_violation` logs while using every page in Chromium. Once they are clean, move `require-trusted-types-for 'script'; trusted-types nextjs` into the main `Content-Security-Policy` in `next.config.js`. Firefox and Safari ignore Trusted Types, so it is an extra layer there, not a replacement.

**Why not `upgrade-insecure-requests`.** `next.config.js` headers are fixed at build time, and the same image runs on plain `http://localhost`, where upgrading every request to HTTPS would break the app. Once you serve HTTPS, HSTS (above) already forces it.

## Deployment hardening

- **App container** ([`docker-compose.yaml`](../docker-compose.yaml)): read-only root filesystem (with a `tmpfs` for `/tmp`), all Linux capabilities dropped, `no-new-privileges`, runs as the non-root `nextjs` user, 512 MB memory and 200 process limits, and a Docker `HEALTHCHECK` on `/api/health` (unauthenticated, returns only `{"status":"ok"}`). MongoDB and RabbitMQ keep their defaults because the official images assume them.
- **Network exposure.** MongoDB, RabbitMQ, and the app are all published on `127.0.0.1` only. The app's address can be changed with `APP_BIND_ADDRESS`; leave it on loopback when a reverse proxy runs on the same host. The app connects to MongoDB as a user with `readWrite` on one database, never as root.
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
| `Blocked request body with a prototype key` | A JSON body contained `__proto__`, `constructor`, or `prototype` |
| `file_uploaded` / `file_deleted` | Attachment changes, with who, which customer, the detected type, and the size |
| `upload_rejected` | An upload failed the type check (a spike is worth a look) |
| `csp_violation` | A browser reported a CSP or Trusted Types violation |

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
7. Watch the logs for `login_rate_limited`, `Blocked cross-origin request`, `upload_rejected`, and `csp_violation`.
8. Keep dependencies current (review Dependabot PRs) and rebuild the image regularly to pick up base-image fixes.
9. Once the Trusted Types reports are clean, promote it to the enforced policy (see [Browser protections](#browser-protections)).
10. Consider serving attachments from a separate, cookieless domain (see below).

## Testing

The security suite is black-box: it talks to a running stack over HTTP and checks behaviour, not implementation.

```bash
docker compose down -v && docker compose up -d --build   # must be a fresh install
npm run test:e2e
```

It creates the first admin through `/setup`, so it needs an empty database and refuses to run otherwise. It runs in CI on every push and pull request. Set `BASE_URL` to point it elsewhere, and `E2E_EXPECT_SECURE=true` if that deployment marks cookies `Secure`.

The upload tests build their hostile files in memory: a JavaScript file renamed `.png`, a Python file, a shebang script named `.txt`, HTML named `.txt`, an SVG with `<script>`, Windows and Linux executables, PNG and GIF polyglots, a macro-enabled Word document, a Word document with a VBA project, one with an embedded `.exe`, and a plain ZIP. Every one must get `415`, and nothing may be stored.

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
- **Inline style attributes are allowed** (`style-src-attr 'unsafe-inline'`, see above). Inline `<style>` elements and foreign stylesheets are not.
- **Trusted Types are report-only** until you promote them (see above).
- **Text sanitization is not an XSS boundary on its own.** It removes markup from what is stored. The boundaries are React's escaping, the CSP, and the lint gates.
- **Uploaded files are not scanned for malware.** The server proves each file's type, but a genuine PDF can still contain JavaScript, launch actions, or exploits for PDF readers, and a genuine Office file is still a ZIP container that can hold external links and OLE-embedded objects. Macros and embedded executables are rejected, but that is not antivirus. Files are never executed or rendered inline by the app, so the risk is to whoever opens a download on their own machine. If that matters, add a scanner (for example ClamAV) before storing.
- **Text attachments can contain code.** A `.txt` or `.csv` is accepted if it is plain UTF-8 text. A Python or JavaScript file renamed `.txt` is accepted as text: it is stored as `.txt` and served as `text/plain`, so it is inert data, but it is still there. CSV cells starting with `=`, `+`, `-`, or `@` can run as formulas when opened in Excel ("CSV injection").
- **Images are not re-encoded.** The polyglot check catches markup, but image metadata (EXIF, including GPS location) is kept, and a malformed image aimed at a specific decoder is not detected. Re-encoding (for example with `sharp`) would fix both, at the cost of a native dependency.
- **Attachments share the app's origin.** Every download is `attachment` with `nosniff` and a sandbox CSP, which makes execution in our origin very unlikely. The stronger design serves user files from a separate, cookieless domain, so even a total bypass can't reach the session.
- **The per-customer file cap is not atomic.** Two simultaneous uploads can overshoot it by one.
- **No audit UI, no session-management screen** (users can't list or revoke their own other sessions, though a password change signs out all of them).
- **No automated dependency-license or SAST scanning** beyond `npm audit`, Dependabot, and the sink check. CodeQL (GitHub's free static analyzer) is the natural addition.
