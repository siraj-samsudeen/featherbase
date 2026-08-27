# Deploying Featherbase

How to run the server in production (#57). This is an *additional* path —
`./init.sh` remains the development boot and is unchanged. This document
supersedes the deployment half of issue #25: the Convex backend it described
died with [ADR 0006](adr/0006-stack-react-hono-postgres.md), and the current
SPA reads no `VITE_*` build variables at all.

## The two-step boot

Every deploy is **release, then serve** — never the reverse, and never both
in one process:

```sh
# 1. Release: apply migrations + patches. Run ONCE per deploy, before any
#    new-code instance serves traffic.
pnpm --filter server release

# 2. Serve: the API server, no file watcher.
PORT=8000 pnpm --filter server start
```

The release step takes a Postgres advisory lock
(`hashtext('featherbase-release')`) for its whole run, so N instances that
all execute it on boot serialize instead of racing: the first applies
everything, the rest wait on the lock and find nothing left to do. It exits
non-zero on the first failure without recording the failed step, so the next
release retries it.

## Configuration

Everything comes from the environment; every variable has a dev default in
`apps/server/src/config.ts` (or at its point of use).

| Variable | Required in production | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | **yes** | Postgres connection string |
| `PORT` | no (8000) | HTTP + WebSocket port |
| `WEB_ORIGINS` | yes, if the SPA is served from another origin | comma-separated CORS allowlist |
| `JWT_SECRET` | **yes** | session/token signing (dev default is `dev-secret-change-me`) |
| `SITE_URL` | **yes, behind a proxy** | this instance's absolute external URL (`https://app.example.com`) — password-reset links and the OAuth `redirect_uri`/cookie-`Secure` decision. Set it and no request header can steer either; leave it unset and the server falls back to the request, trusting the first `x-forwarded-proto` hop |
| `FILE_STORAGE_DIR` | recommended | uploaded-file directory (must persist across deploys) |
| `CHROMIUM_PATH` / `PLAYWRIGHT_BROWSERS_PATH` | for PDF printing | Chromium binary resolution — never hardcoded |

Two settings already in the codebase matter specifically for hosted
Postgres and must not regress: `db.ts` sets `prepare: false` (required by
transaction-mode poolers such as Supabase's on port 6543), and `config.ts`
reads `DATABASE_URL` with a local default.

## Container

`apps/server/Dockerfile` is a minimal, vendor-neutral image. Build from the
repo root so the pnpm workspace resolves:

```sh
docker build -f apps/server/Dockerfile -t featherbase-server .
docker run --rm -e DATABASE_URL=$DATABASE_URL featherbase-server pnpm --filter server release
docker run -d -e DATABASE_URL=$DATABASE_URL -e JWT_SECRET=$JWT_SECRET -p 8000:8000 featherbase-server
```

Any platform that runs a container and can execute a pre-deploy command
(release phase, job, CI step) fits this shape; nothing is welded to one
vendor.

## Single-origin deployment (SPA in the image)

The Dockerfile's `web-build` stage compiles `apps/web` and ships `dist/`
inside the server image. On boot, `index.ts` checks for that directory —
present, it serves the SPA statically with an index-html fallback for
client-side routes, so **one container answers both `/` and `/api` on one
origin**. The websocket (`/ws`) and file routes ride the same origin, and
`WEB_ORIGINS` / CORS becomes irrelevant because the browser never makes a
cross-origin call. A dev checkout has no `dist/`, so `./init.sh` and the
vite proxy on :5173 are untouched.

The server-owned prefixes (`/api`, `/files`, `/private/files`, `/web`,
`/ws`) never fall through to `index.html` — an unknown `/api/*` route still
answers with the JSON error envelope (API-006).

`railway.json` at the repo root encodes this shape for Railway: Dockerfile
build, `pnpm --filter server release` as the pre-deploy (release) step, and
`/api/ping` as the healthcheck. Other platforms map the same three settings
onto their own vocabulary.

## The web SPA, separately hosted

`apps/web` can still be served by any static host (`pnpm --filter web
build` → `dist/`). It reads no build-time environment variables; it talks
to the API on the same origin, so a separate host must reverse-proxy `/api`
(and `/ws`, `/files`) to the server, and the server needs `WEB_ORIGINS` set
to that host's origin. Prefer the single-origin image above unless you have
a reason not to.

## Dev-preview deployments

A second service tracking a `dev-preview` branch, with its own Postgres, so
in-progress work can be clicked rather than described. Sign-in is one link,
as an ordinary named user rather than Administrator. Two extra variables
(`PREVIEW_LOGIN_KEY`, `PREVIEW_LOGIN_USER`) switch it on; without them the
route 404s and nothing changes. Full runbook: [PREVIEW.md](PREVIEW.md).

## Automation credentials (#131)

Scripts, CI, and instance-manifest installs authenticate with **access
tokens**, not the Administrator password (which #130 demotes to break-glass).
Bootstrap them on the production box over SSH — shell access is the
authorization, exactly like the other CLI commands:

```sh
# e.g. on Railway: railway ssh -- pnpm --filter server cli …
pnpm --filter server cli create-service-account svc-installer --roles "System Manager"
pnpm --filter server cli issue-token svc-installer --label "manifest installs"
```

`issue-token` prints the `fbt_…` secret **once**; store it in your secret
manager. It then rides any API call as a normal Bearer token:

```sh
curl -H "Authorization: Bearer fbt_…" -H 'content-type: application/json' \
  -d '{"manifest": …}' https://<host>/api/install_app
```

Tokens are named, listable (`list-tokens`), revocable (`revoke-token`, or
one click in *Admin → Access tokens*), and never retrievable after issue —
only a SHA-256 lands in the database. Optional expiry via `--expires <days>`.
Disabling the service account (Admin screen, or `enabled = false`) dead-ends
every token it owns without destroying them; deleting it revokes them for
good. A service account can never sign in interactively — no password, no
session, no OAuth.

## Smoke check

After a deploy: `SERVER_URL=https://... pnpm --filter server test:smoke`
asserts `GET /api/ping` answers `pong` with a live DB connection. Then
`POST /api/method/login` with valid credentials should return Frappe's
login shape (`{"message":"Logged In", ...}`), and in a single-origin
deployment `GET /` should answer the SPA's `index.html`.
