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
| `FEATHERBASE_ENV` / `NODE_ENV` | **yes** | set to `production` for release and serve; `FEATHERBASE_ENV` takes precedence. Only `development` and `test` allow zero-setup Administrator credentials |
| `ADMIN_PASSWORD` | optional | provisions a null Administrator password hash; missing/blank leaves production password login locked. Never rotates an existing hash |
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

## First admin

A fresh production database has **no default password**. With no nonblank
`ADMIN_PASSWORD`, Administrator's password hash stays null, so password
login is unavailable. The release step warns when no enabled human System
Manager has a password. Provision a named manager on the production box:

```sh
pnpm --filter server cli create-user <email> <password> --roles "System Manager"
```

Use a protected operator shell; do not put real passwords in shared logs or
shell history. Administrator is a break-glass account, not a daily login.
Alternatively, set `ADMIN_PASSWORD` in the deployment secret store before
first release. If migrations already ran with Administrator locked, set it
and deliberately run `pnpm --filter server cli seed`. Ordinary recorded
migrations do not replay bootstrap; seed can provision only a **null** hash.
Development/test still default to Administrator / admin.

Neither release, migrations nor seed overwrites any existing password hash.
In particular, setting `ADMIN_PASSWORD` later is **not password rotation**.
An upgraded deployment with the old known `admin` password receives a loud
release warning, but is not silently locked or rotated. Before exposing it,
use the authenticated password UI to change Administrator's password, or
bootstrap a named manager and explicitly reset/disable Administrator.
That existing credential remains active until the operator acts. A missing
bootstrap password does not disable OAuth or other independently configured
authentication mechanisms.

Migration 0006 remains immutable history; the migration runner explicitly
supersedes its unsafe password action on fresh chains. Migration 0083 and
deliberate seed use the same null-only policy.

## Public-route abuse limits

Password login, Google OAuth initiation/callback, and public web-form POSTs
use atomic Postgres counters shared by every server instance. Deploy all
instances with the same configuration and database; no process-local fallback
admits requests during a database failure. The existing authenticated fairness
limiter is separate. Successful forms still consume admission budget.

| Variable | Default | Budget per source and window |
| --- | --- | --- |
| `PREAUTH_WINDOW_MS` | 900000 | fixed window beginning at first admission, in milliseconds |
| `PREAUTH_LOGIN_MAX` | 60 | all password submissions, across usernames |
| `PREAUTH_PASSWORD_MAX` | 5 | tighter password-provider + trimmed/lowercase username + source budget |
| `PREAUTH_OAUTH_LOGIN_MAX` | 30 | initiation, independent of callback |
| `PREAUTH_OAUTH_CALLBACK_MAX` | 30 | callback, checked before challenge clearing or code exchange |
| `PREAUTH_FORM_MAX` | 30 | all public web-form POSTs |
| `TRUSTED_PROXY_IPS` | empty | comma-separated exact socket IPs trusted to append `X-Forwarded-For`; no wildcard, hostname, or CIDR |

Numeric values must be positive integers no greater than 2147483647; invalid
configuration refuses startup. Tune the source ceiling for shared NAT users,
keeping credential attempts tighter. There is no username-only lockout.
A successful password login forgives its credential bucket only if no newer
attempt was admitted; an older success cannot erase newer attempts. Source
budgets are never forgiven. A 429 uses the standard `RateLimitError` envelope
and `Retry-After` seconds. Windows are fixed, not sliding; expiration can
permit two bursts close together. Each protected request removes at most
100 expired counters using row locks that skip busy rows.

By default the socket peer is authoritative and all forwarded addresses are
ignored. Behind a proxy, explicitly allowlist the actual proxy peer addresses
and require that proxy to append/replace `X-Forwarded-For` correctly. The
server walks right-to-left only while the current hop is trusted, stopping
at the nearest untrusted address. Malformed chains fall back to the socket;
missing socket information shares an `unknown` bucket, never a supplied header.
IPv4-mapped IPv6 is normalized. Do not trust a public client network or assume
`SITE_URL` enables IP-header trust. Supplied sessions/tokens do not bypass
these public-route controls.

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

## Preview deployments

In-progress work that can be clicked rather than described. Sign-in is one
link, as an ordinary named user rather than Administrator. Two extra
variables (`PREVIEW_LOGIN_KEY`, `PREVIEW_LOGIN_USER`) switch it on; without
them the route 404s, the deploy-time seed does nothing, and nothing else
changes.

Railway PR environments give every pull request its own copy with its own
empty database, which is the usual route; a service tracking a `dev-preview`
branch gives a stable always-on URL. Full runbook:
[PREVIEW.md](PREVIEW.md).

## Runtime application upgrades (#296)

The behavior contract is `openspec/specs/trusted-runtime-packages/spec.md`.
Upgrade is **Preview → Upgrade → Activate**, never install-again or reset.
Only a System Manager can call these APIs. This slice supports one server
process and PostgreSQL; packages still have trusted Node/same-origin powers.

### Package author contract

The npm `package.json` version is a numeric `major.minor.patch` triplet. Keep
every previous migration unchanged, in order, in `featherbase.json`. A Tasker
v2 package (`2.0.0`) appends this entry and appends the same column declaration
to its final `tasker.project` Table:

```json
{"migrations":[{"id":"project_description","fromVersion":"0.0.1","toVersion":"2.0.0","operations":[{"kind":"addColumn","table":"tasker.project","column":{"column_name":"description","label":"Description","column_type":"Text"}}]}]}
```

`0.0.1` is the actual original Tasker package version. Optional Text stores
Markdown without rendering it; empty form input normalizes to null. Additions
may use Data, Text, Int, Float, Check, Date or Datetime, without defaults,
required/unique flags or references. A code-only version still appends a
contiguous migration with `operations: []`. This slice rejects SQL, destructive
changes, existing-column edits, new Tables, changed permission declarations,
jobs and dependency declarations. Fresh installation uses the final schema
and records the complete ledger; upgrades apply only its missing suffix.

The built client must pin `X-Featherbase-App-Version: tasker@2.0.0` on requests
that access Tasker Tables (reads as well as writes). Do not obtain that header
from the current catalog: doing so lets stale client code claim compatibility.
After a migrated version activates, obsolete/headerless requests reject with
reload guidance. The proof fixture's fetch adapter is test-only, not a client SDK.

### Artifact delivery and recovery

Build/pack the application separately; unpack each release into its own durable,
immutable directory. Set `FEATHERBASE_APP_PATHS` to a JSON array containing both
prior and target directories, then restart the server to discover them. Retain
all shipped bytes, including manifests and lockfiles: the fingerprint covers
the package tree except `node_modules` and `.git`. Symlinks are refused. Review
trusted module imports; import-time side effects are not sandboxed.

For example, operator-managed persistent paths can be
`["/data/apps/tasker/0.0.1","/data/apps/tasker/2.0.0"]`. Railway must mount those
artifacts into the actual running container and preserve them across releases.
The current Dockerfile bundles just one Tasker directory; overwriting it with
v2 is **not** a safe upgrade delivery strategy. Provision the immutable paths
and override the environment variable explicitly. No package upload API exists.
Once this generic core capability ships, later app-only upgrades need no core
rebuild. Run the normal core release step once to install ledger migration 0095;
never use a reset or demo seed as an application migration.

Discovery selects the installed exact version, not the newest available one.
Missing/changed code makes an installed application unavailable without deleting
rows. `/api/apps` reports versions, pending activation and discovery failures;
server logs provide detailed validation errors. Legacy prototype installations
without a recorded full manifest/version fail closed: recover their reviewed
identity explicitly before attempting upgrade, rather than guessing from the
latest package. There is deliberately no generic automatic legacy adoption API.

The exclusive lifecycle lock drains admitted operations and post-commit work.
PostgreSQL commits column metadata, explicit physical DDL, version and checksum
ledger together. Failure before commit retains old code and all data. Successful
commit suspends old hooks and client access until activation; restart preserves
that pending state. Activation verifies the committed artifact and wires hooks
once. An upgrade of a disabled application remains disabled after activation.

**After commit, restoring old code alone is not recovery.** Restore the exact
target artifact and activate it. No down migration/schema rollback is provided.
The prior artifact identity is retained for diagnosis and matched external backup
restoration; any database restore is a separate, explicitly authorized operation.
If the response is lost, retry the same version/planId: committed work is not
applied twice. For a stale plan, obtain and review a new preview.

### Later authorized Featherbase Dev sequence

These steps are instructions, not authorization to deploy or mutate Dev:

1. Integrate convergence 0094, upgrades 0095 and actions 0096; verify the combined
   build plus the real Tasker v2 package/client. Back up Dev and retain the exact
   installed artifact. Check `/api/apps` for a known installed identity; stop for
   explicit recovery if it is an unversioned prototype.
2. Deliver both immutable artifacts and deploy the generic core release normally
   with the paths above. Inspect `/api/apps`: v1 must still be installed/active
   and v2 merely available. Do not seed or reset Dev. Use a System Manager bearer
   token in the following requests; `BASE` must name the reviewed Dev origin.
3. Preview, inspect the complete output and save its `planId`:

   ```sh
   curl --fail-with-body "$BASE/api/preview_app_upgrade" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"tasker","version":"2.0.0"}'
   ```

4. Expect only `project_description`, no permissions/jobs/indexes/destructive
   effects, existing values unchanged and a nullable new column. Substitute the
   reviewed plan ID, then commit and explicitly activate:

   ```sh
   curl --fail-with-body "$BASE/api/upgrade_app" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"tasker","version":"2.0.0","planId":"REVIEWED_PLAN_ID"}'
   curl --fail-with-body "$BASE/api/activate_app_upgrade" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"tasker","version":"2.0.0"}'
   ```

5. Confirm `/api/apps` reports v2, no pending activation and the intended enabled
   state. Reload Tasker and verify prior project/task/comment/settings/grant
   values. Only now, with authorization to create the project, create **Tasker
   Test Drive** (check that it does not already exist before retrying a lost
   create response; row creation is not the upgrade's idempotent operation):

   ```sh
   curl --fail-with-body "$BASE/api/table/tasker.project" -H "Authorization: Bearer $TOKEN" -H 'X-Featherbase-App-Version: tasker@2.0.0' -H 'Content-Type: application/json' --data '{"project_name":"Tasker Test Drive","description":"## Tasker Test Drive\n\nTry projects, tasks and Markdown descriptions without changing existing work."}'
   ```

   Read the returned row back with the same pinned header, inspect its Markdown
   in the separately delivered Tasker UI, and verify an old tab rejects writes.
   Do not run the local development scenario seeder against Railway.

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
