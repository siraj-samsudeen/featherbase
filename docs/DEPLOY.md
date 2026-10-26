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

Everything comes from the environment. Every variable the server reads is
declared once, in `apps/server/src/env.ts`, with whether it is a secret and
when it is required; the table below and `apps/server/.env.example` are
generated from it, and CI fails when they are out of date. To add a variable,
declare it there and run `pnpm --filter server generate:env`; `pnpm --filter
server lint:env` refuses a `process.env` read anywhere else in the server.

The release (and the server start) refuses while a required variable is
missing — an empty or blank value counts as missing — or while a switch that
only development, test and staging may have is on, and names each one. A
missing recommended variable is printed as a `WARNING:` line and the release
goes ahead. `cli boot-check` runs the same checks read-only. CLI commands
themselves never refuse, so the break-glass commands over `railway ssh`
(`cli set-password`, `cli settings:set`, `cli create-person`) still work while
a variable is missing.

Beyond the table, the instance's data asks for two more. An enabled Google
sign-in method with a client id needs `GOOGLE_CLIENT_SECRET`: the release and
the server start refuse without it (in development and test they warn). A Data
Source needs the variable its `url_env` names: without it the release and the
start only warn, because that one source is unusable while the rest of the
app works, and every query against the source refuses, naming the variable.

<!-- generated:variables:start — from apps/server/src/env.ts by `pnpm --filter server generate:env`; do not edit -->

| Variable | Required | Secret | Default | Purpose |
| --- | --- | --- | --- | --- |
| `FEATHERBASE_ENV` | **yes**, this or `NODE_ENV`, for a release | no | `NODE_ENV`, then `development` | which environment this process is: `production`, `staging`, `development` or `test`; it wins over `NODE_ENV`. The release (and `cli boot-check`) refuses when neither is set (#430). Only `development` and `test` allow zero-setup Administrator credentials |
| `NODE_ENV` | no | no | `development` | read only when `FEATHERBASE_ENV` is unset (Vitest sets it to `test`) |
| `DATABASE_URL` | **yes**, outside development and test | yes | local `featherbase` (`featherbase_test` under test) | Postgres connection string. `db.ts` sets `prepare: false`, which transaction-mode poolers (such as Supabase on port 6543) require (must differ across environments) |
| `PORT` | no | no | `8000` | HTTP and WebSocket port |
| `WEB_ORIGINS` | no | no | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated CORS allowlist; needed only when the SPA is served from another origin |
| `SITE_URL` | **yes**, outside development and test | no |  | this instance's absolute external URL (`https://app.example.com`): password-reset and invitation links, and the OAuth `redirect_uri`/cookie-`Secure` decision. Set, no request header can steer either; unset (development and test only), the server falls back to the request, trusting the first `x-forwarded-proto` hop |
| `JWT_SECRET` | **yes**, outside development and test | yes | `dev-secret-change-me` | session and token signing. Must differ between environments, or one environment's sessions are valid on another (must differ across environments) |
| `FILE_URL_SECRET` | no | yes | `JWT_SECRET` | signs the short-lived URLs of private files (must differ across environments) |
| `ADMIN_PASSWORD` | no | yes |  | provisions a null Administrator password hash; missing or blank leaves production password login locked. Never rotates an existing hash (see [Rotating credentials](#rotating-credentials)) |
| `GOOGLE_CLIENT_SECRET` | **yes**, while a Google sign-in method is enabled with a client id | yes |  | the Google OAuth client secret; the client id and allowed domains live on the Google sign-in method (must match across environments) |
| `FILE_STORAGE_DIR` | recommended (warns when missing outside development and test) | no | `apps/server/storage` | uploaded-file directory; it must persist across deploys (on Railway, a Volume) |
| `CHROMIUM_PATH` | no | no |  | Chromium binary for PDF printing; unset, Playwright resolves its own. Never hardcoded |
| `PLAYWRIGHT_BROWSERS_PATH` | no | no | `/opt/pw-browsers` | where PDF printing also looks for a Playwright-installed Chromium |
| `SMTP_HOST` | no | no |  | turns real delivery on (`smtp-relay.gmail.com`); unset or blank keeps the Email Sink. See [Email](#email) |
| `SMTP_PORT` | no | no | `587` | `587` = STARTTLS, `465` = implicit TLS. On every port but 465, STARTTLS is required |
| `SMTP_USER` | no | no |  | a Workspace user in the domain; turns on SMTP AUTH |
| `SMTP_PASSWORD` | no | yes |  | that user's **app password**; required when `SMTP_USER` is set. Google's grouped display (`abcd efgh ijkl mnop`) has its spaces removed |
| `MAIL_FROM` | no | no |  | the From of every SMTP message (`Feather Dash <noreply@example.com>`); it wins over any Email Account address. Unset, the default Email Account's address is used |
| `SMTP_NAME` | no | no |  | the `EHLO` hostname. Unset, the domain of `MAIL_FROM`, then the host of `SITE_URL`, then the sender's domain |
| `PREAUTH_WINDOW_MS` | no | no | `900000` | pre-auth fixed window, in milliseconds |
| `PREAUTH_LOGIN_MAX` | no | no | `60` | password and delegated sign-in submissions per source and window |
| `PREAUTH_PASSWORD_MAX` | no | no | `5` | per provider, username and source |
| `PREAUTH_OAUTH_LOGIN_MAX` | no | no | `30` | OAuth initiations per source and window |
| `PREAUTH_OAUTH_CALLBACK_MAX` | no | no | `30` | OAuth callbacks per source and window |
| `PREAUTH_FORM_MAX` | no | no | `30` | public web-form POSTs per source and window |
| `PREAUTH_SIGNUP_MAX` | no | no | `10` | sign-ups per source and window |
| `TRUSTED_PROXY_IPS` | no | no |  | comma-separated exact socket IPs trusted to append `X-Forwarded-For` |
| `RATE_LIMIT_WINDOW_MS` | no | no | `60000` | per-user API rate-limit window |
| `RATE_LIMIT_MAX` | no | no | `100000` | per-user API requests per window, unless the person has their own limit |
| `DELEGATED_LOGIN_TEST_MODE` | **never in production**: development, test and staging only | no |  | `trust-any-password` lets a linked account sign in by its employee code without a password, to try a rollout as any linked Team Leader. Any other value is ignored |
| `ALLOW_MOCK_OAUTH` | **never outside development and test** | no |  | `1` turns on the mock Google provider, which mints a session for any typed email from a pre-auth endpoint. For development and the test suites |
| `PREVIEW_LOGIN_KEY` | **never in production**: development, test and staging only | yes |  | preview deployments: the one-link sign-in's secret, 32+ characters. See [PREVIEW.md](PREVIEW.md) |
| `PREVIEW_LOGIN_USER` | **never in production**: development, test and staging only | no |  | preview deployments: the account the link signs in as (never Administrator) |
| `DISABLE_DATABASE_ENVIRONMENT_CHECK` | no | no |  | `1` skips the check that the database was stamped by this environment. Break-glass only |
| `FEATHERBASE_APP_PATHS` | no | no | `[]` | JSON array of extra app package directories to discover at boot |
| `JOB_POLL_MS` | no | no | `500` | background worker poll interval |
| `SERVER_URL` | no | no | `http://localhost:8000` | the server `pnpm smoke` probes |
| `MOTHERDUCK_TOKEN` | no | yes |  | MotherDuck access for the sales-target embed and warehouse reads; never logged, returned or stored |
| `MOTHERDUCK_API_BASE` | no | no | `https://api.motherduck.com` | MotherDuck API base |
| `MOTHERDUCK_EMBED_ORIGIN` | no | no | `https://embed-motherduck.com` | the embed sandbox origin; overridable only for a local stub |
| `DIVE_ID` | no | no |  | the sales-target Dive |
| `DIVE_VERSION` | no | no |  | the sales-target Dive version |
| `SERVICE_ACCOUNT` | no | no |  | the MotherDuck service account the embed runs as |
| `SALES_TARGET_TODAY` | no | no |  | pins "today" (YYYY-MM-DD) for the sales target; for tests and rehearsals |
| `SALES_TARGET_SHARED_ENV` | no | no |  | path of a local `.env.local` the sales-target experiment reads `DIVE_ID`, `DIVE_VERSION` and `SERVICE_ACCOUNT` from |

<!-- generated:variables:end -->

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
pnpm --filter server cli create-person <email> <password> --roles "System Manager"
```

Or, for a manager who will sign in with Google and needs no password (#473):

```sh
pnpm --filter server cli create-person <email> --roles "System Manager" --expects-google-sign-in
```

Their first Google sign-in with that verified address links to them, provided
the Google method's `allowed_email_domains` admits its domain; the mark is then
used up. Put `--expects-google-sign-in` last: it takes no value.

Use a protected operator shell; do not put real passwords in shared logs or
shell history. Administrator is a break-glass account, not a daily login.

Give that manager an email address. System notices (the leaver-check summary,
waiting-for-access alerts) go to enabled System Managers with an address, and
Administrator has none. With no such manager, the release preflight and
`cli boot-check` print a WARNING, and each notice is logged as
`notice_undelivered` in the activity log instead of being sent (#463).
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

### Locked out (#391)

When no System Manager can sign in, reset a person's password from an
operator shell — shell access is the authorization. The password is read from
**stdin only** (an argument is refused: argv lands in shell history and the
process list), must be at least 6 characters, and is never printed. It ends
every live session of that person (sessions issued before the reset, to the
second; access tokens are not sessions — see below), revokes every reset
link emailed to them before it, and writes an Activity Log entry (actor
`cli`, operation `password_set for <person-id>`). Service accounts are
refused; they use tokens.

```sh
# Prompts without echo locally, then pipes the value through the SSH session.
read -rs PW && printf '%s\n' "$PW" | \
  railway ssh -p <project> -e <env> -s <service> -- \
  pnpm --filter server cli set-password Administrator --stdin; unset PW
#   → password set for Administrator; their sessions are ended
#   → access tokens still work — on a suspected compromise: cli list-tokens Administrator, then cli revoke-token <id>
```

The CLI refuses a terminal on stdin by design (a typed password would echo).
If `railway ssh` allocates a TTY for the remote command, or does not forward
stdin, open an interactive shell and pipe it there instead — the password
never lands in shell history or on a command line:

```sh
railway ssh -p <project> -e <env> -s <service>
# then, on the remote shell:
read -rs PW; printf '%s\n' "$PW" | pnpm --filter server cli set-password Administrator --stdin; unset PW
```

`<person-id>` is the Person's id (`Administrator`, or a `psn_…`). Sign in
with the new password, then rotate it through the password UI if it passed
through anything you do not trust.

**Access tokens survive the reset by design** — they are a separate
credential. If the account may be compromised, list and revoke them too:
`pnpm --filter server cli list-tokens <person-id>`, then
`pnpm --filter server cli revoke-token <token-id>`.

### Sign-out ends that session (#411)

Every session carries a unique id. Signing out records it in
`revoked_session` (migration 0106), and that session is refused from then on
on every instance. Signing out an already-expired session records nothing
(expiry refuses it) but still closes its sockets. Realtime sockets live on
one instance: the instance that handled the sign-out closes that session's
sockets at once, and every instance re-checks its open sockets against
`revoked_session` once a minute, so a socket on another instance closes
within about a minute. The same check closes sockets whose token has expired, whose
person was disabled, or whose sessions were ended by the reset above. The person's other sessions are untouched; to end all
of them, use the reset above. Rows are pruned on each sign-out once the
session they name has expired.

If the revocation cannot be written, sign-out answers 503 (the cookie is
still cleared) and the app tells the user sign-out did not complete and
keeps them signed in to retry.

**Deploying it signs everyone out once.** A session opened before this
release carries no id and is refused, so every user — the store staff on
the trial included — must sign in again after the deploy. There is no
grace window (no-backward-compatibility rule). Access tokens are not sessions
and keep working.

## Public-route abuse limits

Password login (including delegated sign-in), Google OAuth initiation/callback,
and public web-form POSTs use atomic Postgres counters shared by every server instance. Deploy all
instances with the same configuration and database; no process-local fallback
admits requests during a database failure. The existing authenticated fairness
limiter is separate. Successful forms still consume admission budget.

| Variable | Default | Budget per source and window |
| --- | --- | --- |
| `PREAUTH_WINDOW_MS` | 900000 | fixed window beginning at first admission, in milliseconds |
| `PREAUTH_LOGIN_MAX` | 60 | all password and delegated sign-in submissions, across usernames |
| `PREAUTH_PASSWORD_MAX` | 5 | tighter password-provider + trimmed/lowercase username + source budget; delegated sign-in IDs have their own bucket of the same size |
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

## Email

With `SMTP_HOST` unset, every outbound message (password resets, the
System Manager test mail, queued and rule-driven email) lands in the Email
Sink, the local mailbox; that is the default for development and the test
suite. Set `SMTP_HOST` and the same messages leave through that SMTP server
instead (#395).

| Variable | Example | Purpose |
| --- | --- | --- |
| `SMTP_HOST` | `smtp-relay.gmail.com` | turns real delivery on; unset or blank keeps the Email Sink |
| `SMTP_PORT` | `587` (default) | `587` = STARTTLS; `465` = implicit TLS. On every port but 465, STARTTLS is **required**: the server refuses to continue if the relay does not offer it. Certificates are always verified |
| `SMTP_USER` | `noreply@example.com` | a Workspace user in the domain; turns on SMTP AUTH |
| `SMTP_PASSWORD` | (secret) | that user's **app password**, not their sign-in password. Required when `SMTP_USER` is set. A value in Google's grouped display (`abcd efgh ijkl mnop`) has its spaces removed; any other value is used exactly as set |
| `MAIL_FROM` | `Feather Dash <noreply@example.com>` | the From of every SMTP message. It wins over any Email Account address, because the relay accepts only senders in the organisation's domains; the Email Account address it replaced becomes the Reply-To. Unset, the default Email Account's address is used |
| `SMTP_NAME` | `example.com` (optional) | the hostname sent in `EHLO`. Unset, it is the domain of `MAIL_FROM`, then the host of `SITE_URL`, then the domain of the sender address. The machine's own hostname is never used: a container's has no dot, and relays such as Google's refuse it. Must be a hostname, or `ECONFIG` |

Production uses port 587. TLS is always required: there is no setting that
lets mail or a credential leave unencrypted, and none that skips the
certificate check.

### Google Workspace SMTP relay (your Workspace domain)

In the Admin console: **Apps → Google Workspace → Gmail → Routing → SMTP
relay service → Configure**, then:

- **Allowed senders:** Only addresses in my domains.
- **Authentication:** Require SMTP Authentication (leave "Only accept mail
  from the specified IP addresses" off unless the host has a fixed egress IP).
- **Encryption:** Require TLS encryption.

Then set `SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`,
`SMTP_PASSWORD` and `MAIL_FROM` on the service. The relay can take a few
minutes, occasionally up to an hour, to accept a new configuration.

The relay refuses an `EHLO` name that is not a fully qualified domain, with
`421 4.7.0 Try again later, closing connection. (EHLO)`, which `mail:test`
reports as `Mail delivery failed (ECONNECTION 421)`. The `MAIL_FROM` domain
(your Workspace domain, e.g. `example.com`) is a name it accepts, so nothing more is needed; set
`SMTP_NAME` only to greet with a different hostname.

The `SMTP_USER` account must have **2-Step Verification** turned on; only then
can it create an **app password** (myaccount.google.com → Security → App
passwords), and that app password is `SMTP_PASSWORD`. Treat it like any other
secret: set it in the platform's variables, never in the repository.

### Checking it, and what a failure looks like

```sh
pnpm --filter server cli mail:test <your-address>
# → mail:test: sent a test message via SMTP smtp-relay.gmail.com:587
```

It exits 1 with `Mail delivery failed (<code> [<SMTP reply code>])` when the relay
refuses, and first prints the relay's own reply line as
`mail:test: server reply: …`, with every email address in it and
`SMTP_PASSWORD` masked out. That line is printed by `mail:test` only; the
stored error and the log line carry the code alone. Codes: `EAUTH` = wrong user or app password; `ETLS`/`ESOCKET`/`ECONNECTION` =
TLS or network; `EENVELOPE` = a sender or recipient the relay rejected. A
bad setting (unparseable `SMTP_PORT`, `SMTP_USER` without `SMTP_PASSWORD`, no
`MAIL_FROM` and no Email Account) reports
`Mail configuration invalid (ECONFIG): …`.

A failure is never dropped silently. Each one writes one structured log line,
`{"level":"error","event":"mail_delivery_failed","purpose":"…","code":"…","smtp_response_code":…}`,
with no address, subject, body or credential in it:

- **Password reset** (`purpose: password_reset`): the request does not wait
  for the SMTP server, and the public route answers `{ ok: true }` either
  way, so neither a failure nor its timing reveals whether the account
  exists; the log line is the only trace.
- **Queued email** (`purpose: queued_email`): a transient failure (a 4xx
  reply, or the server unreachable or timing out) puts the Email Queue row
  back to `queued` for the job's retry; a permanent one (a 5xx reply, bad
  credentials, the job's last attempt) turns it `error`. Either way the row
  carries the same safe message.
- **Test mail** (Settings or `cli mail:test`): the error is returned to the
  System Manager (HTTP 503).

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

The generic Featherbase client is metadata-driven rather than package-built.
Before its first authenticated metadata/data request, it resolves
`GET /api/runtime_app_versions` and pins that active-identity snapshot for the
signed-in page lifetime. Form saves, references, File/Comment metadata and
multipart uploads reuse it. For requests touching several apps, the same header
accepts distinct comma-separated identities; every accessed app still requires
its own exact installed version. Duplicates and malformed entries are refused.
Navigation, refetch and 409 never refresh the snapshot: reload the page after
upgrade/activation or installing another app. Pending, disabled, unavailable and
unversioned packages are not advertised. Public OAuth/password-reset/logout and
public-form requests do not bootstrap first, so expired saved credentials cannot
block their existing public contracts.

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

## Sign-in methods and linked identities (#275)

A **Person** is a human (#275, `person-rename`). Its `row_id` is the
permanent person id (the warehouse `person_id`): an opaque `psn_…` id
Featherbase assigns, never an address, a username or an employee code, and it
cannot be renamed. Administrator and Guest are the two built-in persons and
keep their ids. A person's name, address and `username` (for password
sign-in) are separate fields. Automation accounts are not persons — see
*Automation credentials*. Email is
optional contact data, unique ignoring case where present; an address ending
in `.invalid` is refused (417) — send no email instead. The ways in are
rows of the system Table **Sign In Method** (Admin → Sign In Method, System
Managers only); one row is one provider issuer:

| Row | Kind | Rule for people it does not know (`new_person`) |
| --- | --- | --- |
| `password` | password | `refuse` (default) — `create` opens username sign-up |
| `google` | google | `create_if_email_domain_allowed` (default, with `allowed_email_domains`; a company domain must match Google's Workspace claim), `create` or `refuse` |
| e.g. `stylehr` | delegated_password | `refuse` only — the service cannot vouch for a permanent ID |

Google uses the row's `client_id` (the secret stays `GOOGLE_CLIENT_SECRET`);
the upgrade turns the `google` row on only if a client id was configured, and
an enabled method can never be left unusable;
only one `password` and one `google` row may exist. Turning a row off ends the
sessions opened through it. Featherbase refuses any change that would leave an
enabled Administrator or System Manager with no way in — turning a method off,
deleting it, blanking Google's client id, or unlinking or moving their link —
and a delegated link never counts as their way in. **Keep sign-up closed**
until what the `All` role can read has been audited.

Outside accounts are linked to a person by the provider's permanent ID —
Google's account ID, the StyleHR employee code — never by email:

- `GET|POST /api/people/<person>/identities` (System Manager): link StyleHR
  `{"method":"stylehr","subject":"RR-0101","sign_in_name":"name_9999999999"}`;
  invite a Google address `{"method":"google","email":"person@example.com"}`
  — the first Google sign-in with that verified address links it for good.
  **Any change to the person's email cancels every unused invite they hold**;
  invite again after changing an email.
- Instead of an invite, tick **Expects Google sign-in** on the Person (System
  Manager only, #473). The first Google sign-in links to them only if Google
  verified the address, it is the person's own email, its domain is in the
  Google method's `allowed_email_domains`, the person is enabled and has no
  Google sign-in yet. The link clears the mark and is logged as a `system`
  activity; any other Google link clears it too. Otherwise the sign-in gets
  today's answer (refused as an address already in use).
- `PATCH /api/identities/<id>` `{"sign_in_name": …}` renames a StyleHR login
  ID (sessions survive) or `{"person_id": …}` moves a link to another person in
  one step (a store mailbox at a Store Manager handover).
- `DELETE /api/identities/<id>` unlinks.
- Re-posting an identical link answers 200 with it; a clash answers 409 with
  `fields.clash` (`subject`, `sign_in_name` or `invite`), `fields.identity` and
  `fields.person`. Every change is in the Activity Log under the administrator
  who made it.
- On a **Person form**, System Managers have a Sign-in methods panel: link a
  connected service (employee code + login ID), invite a Google address,
  unlink. Moving a link is the `PATCH` above.
- People see and manage their own under **Sign-in methods** (account menu,
  sidebar, and the sales-target report header), and can link Google there
  within 15 minutes of signing in. A test-mode or preview-link sign-in can
  read but cannot set a password, mint a token, or link or remove a sign-in
  method.

`GET /api/brand` lists the enabled methods and returns `identity_links: true`,
which the roster sync checks before writing links.

### Delegated password sign-in (StyleHR)

People with no Google account and no Featherbase password can sign in with
the ID and password of another system the organisation trusts. Featherbase
POSTs `{"email": <ID>, "password": <password>}` as JSON to the row's
`service_url` (10 s timeout, redirects not followed) — but only for a login ID
linked to exactly one enabled, non-privileged person (case and surrounding spaces
ignored); any other ID is refused as a wrong password without contacting the
service. Only a JSON answer with a clear yes (a token, an employee id, or
`success: true`) signs in. A JSON no, or a 4xx, is a wrong password. An answer
showing the person has left **disables the account**, which ends all their
sessions and every other way in. Anything else — empty, a web page, 3xx,
408/429, 5xx, a timeout — reports the service as unavailable, never as a
wrong password, and never falls back to another method. The password is not
stored or logged. The Administrator and System Managers can never sign in this
way. With two delegated rows enabled, the sign-in names its `method`.

To turn it on for StyleHR, as a System Manager, add a Sign In Method row:
`row_id` `stylehr`, kind `delegated_password`, label `StyleHR`, service URL
`https://stylehr.in/api/login/` (keep the trailing slash; StyleHR redirects
without it, and a redirected POST loses its body). Then link each person as
above.

The row's `settings` JSON describes the provider's wire format; anything left
out takes StyleHR's value: `id_field` / `password_field` (request body names,
`email` / `password`), `nested_keys`, `success_keys`, `success_flags`,
`error_keys`, `status_key`, `error_statuses`, and the leaver rules
`left_date_keys`, `inactive_flags`, `left_status_keys`, `left_words`. Another HR
system with a different request or answer shape is a new row with its own
`settings`, not code. Sign-in never reads the old `stylehr_username` Custom Field; migration
0107 drops it (#408).

**Deploying the upgrade (#275) — mandatory runbook:**

1. Freeze the roster sync (do not run it until step 5).
2. Run `pnpm --filter server cli identities:plan` against the instance. It is
   read-only. It lists, by name and id, every email it will clear, every
   one-time Google invite, everyone **listed for an explicit Google invite**
   (a real email but never signed in with Google — they are deliberately not
   invited automatically), and a **parity check**: how many people can sign in
   today and how many keep a way in, naming each exception. Keep the output.
3. Snapshot the database, then deploy (migration 0100 runs). **Every session
   ends**: everyone, trial users included, signs in once more. No old shape is
   accepted after the deploy — not the old `/api/brand` fields, not a
   delegated sign-in without `method`, not a `.invalid` email (so the roster
   sync must be updated before it runs again), and `user.social_login` is
   dropped (the warehouse mirror sees the column disappear).
4. **Right after the deploy, invite every listed person** — Person form →
   Sign-in methods → invite their Google address (or
   `POST /api/people/<id>/identities {"method":"google","email":…}`). Until then
   they cannot sign in with Google.
5. Run the updated roster sync: people the old sync creates have no StyleHR
   link.

**The upgrade clears the seeded `admin@example.com` and `guest@example.com`.**
The Administrator then signs in with the user id `Administrator`, no longer
with that address. The plan lists these under "seed addresses cleared"; give
the Administrator a real email afterwards if signing in by email matters.

**Known limitation:** a roster sync that links StyleHR identities on every run
will re-link one that the person removed themselves under Sign-in methods. The
roster-sync change (filed in the data-warehouse repo) is to respect removals;
until then, remove a StyleHR link from the roster source, not only in
Featherbase.

**`DELEGATED_LOGIN_TEST_MODE=trust-any-password` lets anyone sign in as any
linked staff member by employee code, with no password.** Never set it where
real users sign in, and remove it at the end of the trial. Test-mode sessions
cannot change access, but they can read everything that person can.

## Instance settings (#465)

An instance's non-secret settings are kept in one reviewed file in the
instance's own private repository, `featherbase/instance-settings.json`, next
to its `manifest.json`. The file decides those settings in every environment.
Secrets never go in it: they stay in the host's secret store (see
[Configuration](#configuration)).

**What the file manages.** Featherbase declares the scope, not the file:

| Table | Shape | Fields the file may set |
| --- | --- | --- |
| `System Settings` | one object | every field (`app_name`, `time_zone`, `session_hours`, `privacy_notice`, …) |
| `Sign In Method` | rows by `row_id` | every field; a row the environment lacks is created |
| `Scheduled Job` | rows by `row_id` | `enabled` only; the job itself comes from code |

A field the file leaves out is not managed, and keeps whatever the
environment has. A text field may name a file next to the settings file
instead of holding the text, for example
`"privacy_notice": { "file": "privacy-notice.md" }`.

```json
{
  "settings": {
    "System Settings": { "app_name": "Example Dash", "privacy_notice": { "file": "privacy-notice.md" } },
    "Sign In Method": [{ "row_id": "google", "allowed_email_domains": "example.com,example.org" }],
    "Scheduled Job": [{ "row_id": "disable_leavers", "enabled": true }]
  },
  "environments": {
    "dev": { "settings": { "Scheduled Job": [{ "row_id": "disable_leavers", "enabled": false }] } },
    "production": {}
  }
}
```

**Values that differ by environment** go in that environment's section, and
nowhere else: the sections are the list of intended differences. An object
merges field by field; rows merge by `row_id`. When the file has sections,
every apply must name one, and a name the file does not list is refused, so a
typo cannot apply the base alone.

**Applying it.** The instance repository's workflow sends the file on merge,
and on demand, with a System Manager service account's token:

```bash
curl -fsS -X POST "https://<host>/api/instance-settings/apply" \
  -H "authorization: Bearer $FEATHERBASE_TOKEN" -H 'content-type: application/json' \
  -d '{ "file": <instance-settings.json>, "environment": "dev",
        "files": { "privacy-notice.md": "<its text>" },
        "source": { "revision": "<commit sha>", "run": "<workflow run id>" },
        "dry_run": true }'
```

or, on the server itself:

```bash
pnpm --filter server cli settings:apply --file featherbase/instance-settings.json --environment dev --dry-run
# e.g. on Railway:
railway ssh -p <project> -e <env> -s <service> -- pnpm --filter server cli settings:apply --file … --environment dev
```

- **One transaction.** Every change goes through the normal save path, as the
  actor `instance-settings`, so each lands in the row's history. Any problem
  (an unknown Table, row or field, a value the field refuses, a wrong type, a
  file that was not sent) lists every problem at once and changes nothing.
- **The result** names each changed setting with its old and new value, or
  says `nothing changed`. The Activity Log records `settings_apply <environment>
  revision <sha> run <id>: <n> settings changed`, with who sent it.
- **Dry run** (`"dry_run": true`, `--dry-run`) reports the same changes and
  the same problems, and writes nothing. Run it as the pull request check.
- **A feature's secret.** A file that leaves a Google sign-in method on with a
  client id is refused while `GOOGLE_CLIENT_SECRET` is unset on that server
  (on development and test it only warns, as the release does).

**Starting the file from a running environment:**

```bash
pnpm --filter server cli settings:export --dir featherbase/
# writes instance-settings.json, and privacy-notice.md when one is set
```

or `GET /api/instance-settings/export` with a System Manager token. Applying
an export to the environment it came from reports `nothing changed`. An export
never carries a secret: the scope holds no secret field, and a value that
holds one anyway (a secret variable's value pasted into a setting, a web
address with credentials in it, a JSON key such as `api_token`) is left out
and named on stderr (`withheld` over HTTP).

**Manifests no longer carry settings.** An app manifest's `fixtures` may not
set a Settings Table (System Settings among them); the install is refused and
names this section. Moving an instance's settings out of its manifest changes
nothing live: fixtures were applied only at install, a release never re-applies
them, and uninstalling an app installed with one leaves the settings as they
are (`apps/server/test/settings-fixture-release.test.ts` proves it on a
database seeded by the previous code).

**Checklist for each environment:**

1. After a **fresh or restored database**, run the instance repository's
   on-demand apply (or `cli settings:apply`) once. Until then the environment
   runs on defaults, not on the file.
2. Turn on the host's **deploy-failure notification** for the environment
   (on Railway: the project's notification settings, deploy failed, to the
   owners). A failed release leaves the old code serving, and nothing inside
   Featherbase can report a release it never ran.

### Instance health

System Managers see every health check at **Admin → This instance → Instance
health** (`/featherbase/admin/instance-health`), each with its state, why it
matters, how to fix it, and its history. While any check fails, every System
Manager (and the built-in Administrator) sees a one-line banner on every Admin
page: red when a failing check is an error, amber when only warnings fail.
The banner cannot be dismissed; it goes once the cause is fixed.

| Check | Severity | Fails when |
| --- | --- | --- |
| A System Manager with an email address | error | no enabled System Manager has an address, so system notices reach nobody |
| Recommended deployment variables | warning | a recommended variable (or one the settings make required) is unset |
| Settings file applied | error | the settings file was never applied on this database ("The settings were never applied.") |
| Settings match the file | warning | a field the file set was changed outside it (`cli settings:set`) |
| Scheduled job: `<method>` | error | an enabled job's last run failed, or it has not run for twice its cadence |
| Administrator default password | error | outside development and test, the Administrator still has the default password |

The same checks are printed by the release step (`health: passing …` /
`health: FAILING …`; a failing check never stops a release), and the
`check_instance_health` scheduled job runs them every 15 minutes, so the
history is right even when nobody opens the page. Only changes of state are
recorded (`health_check_event`).

## Privacy notice (#401)

`/privacy` is a public page (no sign-in, no app JavaScript) that shows the
instance's own privacy notice — Google's consent screen links to it. The
wording is **instance configuration, not code**: this repository is public and
never carries an organisation's notice. Until one is set, `/privacy` answers
a plain 404 page ("No privacy notice is published here."). Responses are
cacheable for five minutes, so a change can take that long to show.

- **Where the text lives:** in the organisation's own repository, as a
  reviewed Markdown file. Changes to it go through that repository's review
  and approval, not this one.
- **Where it is stored:** the System Settings field `privacy_notice`
  (Markdown). Raw HTML in it is shown as text, never rendered; links work.
  Images never load: image syntax shows as a link with its alt text.
- **How to apply it:** through the instance settings file, as
  `"privacy_notice": { "file": "privacy-notice.md" }` (see
  [Instance settings](#instance-settings-465)). The one-field command below
  is the break-glass path:

  ```bash
  pnpm --filter server cli settings:set privacy_notice --stdin < privacy-notice.md
  # e.g. on Railway:
  railway ssh -p <project> -e <env> -s <service> -- pnpm --filter server cli settings:set privacy_notice --stdin < privacy-notice.md
  ```

  The CLI writes only System Settings text fields (typed ones are set in the
  form) and records
  `settings_set <field>` in the Activity Log with actor `cli`.

  Not yet rehearsed over `railway ssh` (#401): if the file does not reach the
  remote command, a System Manager pastes it into the System Settings form
  instead. Either way, check the result at `https://<host>/privacy`.

## Invitation email (#430)

Inviting a Google address on a Person's sign-in methods emails it by default
(the inviter can untick it; Resend sends it again, at most once in ten
minutes). The email is built from instance configuration, never from the
repo:

- **Name:** System Settings `app_name` ("Example Dash invited you…").
- **Introduction (optional):** System Settings `invitation_email_intro`, plain
  text, one paragraph or two on what the service is for. Set it in the form or
  `pnpm --filter server cli settings:set invitation_email_intro --stdin < intro.txt`.
- **Link:** `SITE_URL` + `/featherbase/login`. Outside development and test,
  `SITE_URL` is **required**: the release preflight refuses to start without
  it, and no invitation is sent (the inviter is told why). A link is never
  built from a request's Host header there.

Mail goes through the instance's transport (the Email Sink until SMTP is
configured). A send that has not finished in 20 seconds counts as failed; if
the transport completes it later, a resend can deliver a second copy. A failed send leaves the invite in place, tells the inviter, and
logs `mail_delivery_failed` with purpose `sign_in_invitation` and no address.

## Automation credentials (#131)

Scripts, CI, and instance-manifest installs authenticate with **access
tokens**, not the Administrator password (which #130 demotes to break-glass).
Bootstrap them on the production box over SSH — shell access is the
authorization, exactly like the other CLI commands:

```sh
# e.g. on Railway: railway ssh -- pnpm --filter server cli …
pnpm --filter server cli create-service-account svc-installer --roles "System Manager"
#   → created service account svc_… ("svc-installer")
pnpm --filter server cli issue-token svc_… --label "manifest installs"
```

A service account is its own kind of account (`person-rename`), not a person:
its own system Table **Service Account** with a minted `svc_…` id and a name
(a lowercase slug). It holds roles, data scope and shares exactly as a person
does, and its tokens work like a person's. Its rows are read-only in the
generic Admin screens; create it, enable or disable it and set its roles
through *Admin → Access tokens* or the API (`POST /api/service_accounts
{"label","roles"}`, `PATCH /api/service_accounts/<id> {"enabled"}`,
`POST /api/service_accounts/<id>/roles {"roles":[…]}`, System Manager only).

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
every token it owns without destroying them. An account that still holds
tokens, data scope, shares or roles cannot be deleted — the database refuses;
revoke or disable instead. A service account can never sign in interactively —
no password, no sign-in method, no email.

## Rotating credentials

Featherbase reads each credential from one place, and several of them are
**not** read where an operator would first look. Rotate every credential on
**each** environment separately (dev first, then production): each one has its
own database and its own variables. The pattern for every secret below is the
same: create the new value in your secret store, set it, restart, verify, and
only then revoke the old one. Never paste a value onto a command line or into
a log; pipe it from the secret store.

A variable change reaches the server only when the process restarts (most
platforms redeploy a service when one of its variables changes). Every
instance of a service must carry the same value.

### Administrator and other passwords

**Changing `ADMIN_PASSWORD` does not change the Administrator's password.** It
is read only to fill an Administrator password hash that is still null: on a
fresh database's first release, or a deliberate `cli seed` (see
[First admin](#first-admin)). After that, the stored hash is the live password,
and it changes only through the password UI or this command, run on each
environment's own shell:

```sh
<read-from-secret-store> | pnpm --filter server cli set-password Administrator --stdin
#   → password set for Administrator; their sessions are ended
#   → access tokens still work — on a suspected compromise: cli list-tokens Administrator, then cli revoke-token <id>
```

The same command takes any person's id (`psn_…`). The password comes from
stdin only (one trailing newline is dropped), and the command refuses a
terminal. It ends that person's sessions, revokes their emailed reset links and
writes an Activity Log entry. It leaves their access tokens alone; see below.
[Locked out](#locked-out-391) shows how to pipe the value through a remote
shell.

Then set `ADMIN_PASSWORD` to the new value as well, or remove it, so that a
future fresh bootstrap does not provision the old one. #467 plans a release
warning for a deployment whose `ADMIN_PASSWORD` no longer matches the live
Administrator password.

**Verify:** sign in as Administrator with the new password, and confirm the old
one is refused.

### Access tokens

Access tokens (`fbt_…`) are a separate credential: no password reset,
`JWT_SECRET` change or restart affects them. Only their SHA-256 is stored, so a
token cannot be shown again; rotating means issuing a new one and revoking the
old:

```sh
pnpm --filter server cli list-tokens [<principal>]   # id, state, owner, label, expiry, last used
pnpm --filter server cli issue-token <principal> --label "<purpose>" [--expires <days>]
#   → prints the secret once; write it straight into the secret store
pnpm --filter server cli revoke-token <old-token-id>
```

Update every consumer to the new token before revoking the old one. **Verify:**
`list-tokens` shows the new token's last-used time move and the old one as
`revoked`. Disabling a service account ends all of its tokens at once.
*Admin → Access tokens* does the same from the UI.

### `JWT_SECRET`

`JWT_SECRET` signs every **session**. Changing it ends every session on that
environment: every person must sign in again. It also invalidates any Google
sign-in in progress (the OAuth state is signed with it and lasts 10 minutes)
and any private-file link already handed out (5 minutes; these use
`FILE_URL_SECRET` instead when it is set). It does **not** affect access tokens,
emailed password-reset links or invitations; those are stored in the database.

Use a long random value (for example `openssl rand -base64 48`, written
straight into the secret store). Change it in a quiet window. During a rolling
deploy, an instance still on the old value refuses sessions the new one issued,
so restart all instances together.

**Verify:** a session opened before the change is refused; a new sign-in works.

### Database password

Change the role's password in Postgres (`ALTER ROLE … PASSWORD …`, or your
provider's rotate-credentials action), then update the variable that holds it.
Point every consumer's `DATABASE_URL` at that one variable through a
**reference variable** (for example Railway's `${{<db-service>.DATABASE_URL}}`)
rather than a copied-in literal URL. A consumer that references it picks the new
value up on its next deploy; a literal copy has to be found and edited by hand.
Redeploy every consumer, including any outside Featherbase that reads the same
database.

Postgres keeps existing connections open after a password change, so a
consumer you missed keeps working until it next reconnects, then fails.
**Verify** each consumer after its redeploy instead: `pnpm --filter server cli
boot-check` connects to the database, and `GET /api/ping` answers `pong` only
with a live connection (see [Smoke check](#smoke-check)).

### Google OAuth client secret

The client **id** is stored in the `google` row of **Sign In Method**; only the
secret is a variable, `GOOGLE_CLIENT_SECRET`. In the Google Cloud console, add a
new secret to the OAuth client, set `GOOGLE_CLIENT_SECRET`, restart the service
(that is what makes it read the new value), then sign in with Google once. Once
that works, disable and delete the old secret in the console. Existing sessions
are not affected: the secret is used only when a sign-in completes.

### `SMTP_PASSWORD` (app password)

`SMTP_PASSWORD` is the app password of the `SMTP_USER` account (see
[Email](#email)), not its sign-in password. Create a new app password at the
mail provider, set `SMTP_PASSWORD`, restart, then run
`pnpm --filter server cli mail:test <your-address>`: it prints the relay's host
and port, never the password, and masks the password in a refusal (`EAUTH` = a
wrong user or app password). Then **revoke the old app password at the
provider**; a leaked one keeps working until you do.

### Order of operations

For a planned rotation, or after a suspected leak:

1. Generate each new value into the secret store first.
2. Passwords of Administrator and every System Manager (`set-password`), so you
   always hold a working way in.
3. Access tokens: issue, update consumers, revoke the old.
4. `JWT_SECRET`: ends every session still open, including any opened with a
   stolen credential.
5. The Google client secret, then `SMTP_PASSWORD`: each one revoked at the
   provider only after it is verified.
6. The database password last; it touches every consumer.

To check that a deployed variable matches the secret store without printing
either, compare fingerprints: run
`printf %s "$VALUE" | shasum -a 256 | cut -c1-12` locally against the stored
value, and `printf %s "$JWT_SECRET" | sha256sum | cut -c1-12` (quoted so the
remote side expands it) on the service's shell. The same 12 characters mean
the same value.

## The person release: `person-rename` (0101) + `person-resolution` 1a-i (0102)

One rehearsed release, inside a maintenance window (#275). Prod is
platform-only; dev holds the trial accounts, which are re-keyed once.

**What 0101 does.** `user` → `person` (Admin "Person", API `/api/people/…`;
**`/api/users/…` is gone, with no alias**); `user_identity` →
`sign_in_identity` (`person_id`); service accounts move to their own table
with fresh `svc_…` ids and keep their tokens, roles, data scope, shares and
rate limit; tokens, data scope, shares and roles refer to a principal through
a `person` / `service_account` pair (exactly one set); every non-built-in
person is re-keyed to `psn_…` (a #371 `usr_…` id too). The re-id goes through
the handler registry (`src/person-registry.ts`), which classifies every text
column as id / json-with-ids / conditional-id / code / free-text; an
unclassified column stops the migration. After the rewrite an exact-match
scan of the registered columns aborts the whole migration if any old id
survives. Codes (`employee_code`, `stylehr_username`, a sign-in `subject`) and
free text (comment bodies, notification subjects, activity messages) are left
alone. The map is kept in `person_id_map (old_id, new_id, kind)`.

**What 0102 (person-resolution Phase 1a-i) does.** Adds the Identifier
System Table (core rows `phone`, `email`), `person_identifier` with its
history constraints, the reviewer and sync roles (`Data Quality Manager`,
`Identity Sync`), `person.replaced_by`, ended sign-in identities
(`ended_at`, `ended_reason`, `subject_kind`; uniqueness only among live
ones), Sign In Method's `identifier_system`, and the core `people_review`
setting. It needs the **`btree_gist`** extension (`create extension if not
exists btree_gist`; Railway's Postgres 18.6 offers it). Where the StyleHR
sign-in method exists (dev) it also:

- applies the instance's seed pack (`stylehr-employee-id`, Restricted-hidden;
  `stylehr-employee-code`, scoped by firm) and links the StyleHR sign-in
  method to the record numbers;
- writes an employee-code row for every `employee_code` Custom Field value
  (assigner `''`, adopted later by the sync) and an `email` row for every
  address;
- marks every live StyleHR sign-in as **keyed by its employee code**
  (`subject_kind = 'employee-code'` — its subject today IS the code), and
  prints **PARITY through test mode's own lookup**: each StyleHR sign-in that
  works today, typed as its code, still finds the same person.

**0102 reads no file.** Moving each StyleHR sign-in to its **StyleHR record
number** is a separate step after the deploy, `cli people:resolve` (dev step 7).

**The release cannot half-apply.** `release.ts` runs a **preflight before the
first migration** (`src/release-preflight.ts`): the database's environment
stamp matches `FEATHERBASE_ENV`; test mode is allowed for that environment
**and** for the database's own label (a database labelled `production` never
runs with test mode, even with the stamp check overridden); `btree_gist` is
available and creatable when 0102 is pending. Any refusal stops the release
before it has changed anything. Then **0101, 0101a and 0102 apply as one
transaction** (`ONE_TRANSACTION` in `src/migrate.ts`): if any of them fails,
none of them is applied.

Test mode (`DELEGATED_LOGIN_TEST_MODE=trust-any-password`) now resolves a
typed employee code through the people's **current employee-code rows** of
the method's own code system (verified or not), refuses a code current on
two people, and needs a live link to the service. **A server whose
environment is not `development`, `test` or `staging` refuses to start with
test mode set** ("DELEGATED_LOGIN_TEST_MODE is set on a "production" server
…").

**`staging` is the environment of a hosted trial instance**: it admits test
mode and is production in every other respect. `development` is *not* safe
on a public host — it gives a null Administrator hash the known password
`admin` and silences the known-password warning. `FEATHERBASE_ENV` also
names the environment the database is **stamped** with
(`internal_metadata.environment`); the migrator refuses a database stamped
for another environment, so changing the variable needs one re-stamp (dev step 1).
Dev today has `FEATHERBASE_ENV=production`, `DELEGATED_LOGIN_TEST_MODE` set
and a database stamped `production`: deployed as is, the release refuses at
its preflight. Prod (no test mode) skips the re-stamp.

**`cli boot-check`** (read-only) runs exactly: (1) the server's start-up
refusal — the variable registry ([Configuration](#configuration)), test mode
outside `development`/`test`/`staging` among it; (2) the release preflight
above against `DATABASE_URL`. It prints one line per check; any
refusal is an error and a non-zero exit.

**Consequences.** Every session ends (the JWT subject changes): everyone signs
in once more; the sign-in page says the session ended. **Access tokens keep
working** — the secret is unchanged; only the owner column is re-keyed.

### Before the dev window

A. **Rehearse on a fresh snapshot, with the target's real variables.**
   `pg_dump -Fc` dev, restore it into a local Postgres 18, and re-stamp the
   copy `staging` exactly as step 1 will (`update internal_metadata set value
   = 'staging' where key = 'environment'`). Export the target's
   `FEATHERBASE_ENV` (`staging`), `DELEGATED_LOGIN_TEST_MODE`,
   `ALLOW_MOCK_OAUTH` and `ADMIN_PASSWORD`-set-or-not exactly as the target
   will have them, with only `DATABASE_URL` pointing at the copy; then:
   1. `pnpm --filter server cli boot-check` — "the server will start" plus
      five `release preflight` lines;
   2. `pnpm --filter server cli people:plan --rehearse <local-dsn> --map --columns --check-sign-in <a trial code>`
      — every pending migration in one rolled-back transaction: the id map,
      every text column with its class, the scan, 0102's parity, the
      test-mode check; any unclassified column or scan hit stops here;
   3. `pnpm --filter server release` on the copy, then the step-5 counts, and
      `pnpm --filter server cli people:resolve <stylehr_record_ids.csv> --dry-run`.
B. Announce the maintenance window to the trial users: 30 minutes outside
   store hours (proposed 06:00–06:30 IST).

**No CDC step belongs in the dev window.** The only Featherbase CDC worker,
`<cdc-worker>`, mirrors **prod**, not dev. Pausing it, switching
its registration and verifying the warehouse all happen when the release is
promoted to production (below).

### In the dev window — in this order

1. **Re-stamp `staging`.** Set `FEATHERBASE_ENV=staging` **and**
   `DISABLE_DATABASE_ENVIRONMENT_CHECK=1`; redeploy the **current** dev
   release (nothing pending) — the migrator skips the stamp check once and
   re-stamps the database `staging`. Remove
   `DISABLE_DATABASE_ENVIRONMENT_CHECK` (never leave it set). Check:
   `/api/ping` answers `"environment":"staging"`; `select value from
   internal_metadata where key = 'environment'` is `staging`; a trial sign-in
   still works.
2. **Snapshot — the rollback point.** After the re-stamp, so a restore comes
   back already `staging`:
   `pg_dump -Fc --no-owner "$DATABASE_URL" > featherbase-dev-pre-person-<YYYY-MM-DD>.dump`,
   then `pg_restore -l` on the file must list `featherbase.user`. Keep it
   until the release is signed off.
3. **`cli boot-check`** in the dev service's own environment (its real
   variables and `DATABASE_URL`):
   `railway ssh -p <project> -e dev -s <service> -- pnpm --filter server cli boot-check`.
   Expect "the server will start", then
   `database environment matches "staging"`, `test mode on, allowed here`,
   `btree_gist available for 0102`, `no publication blocks updates on a
   table with stored generated columns`, and the pending migrations (0101,
   0101a, 0102). Any error: stop here; nothing has changed.
4. **Deploy.** The release logs its `preflight:` lines, then
   `applied 0101_person_rename.ts (one transaction: 0101…, 0101a…, 0102…)`.
   Read: `scan: no old id survives in any registered column`;
   `PARITY (test mode's own lookup): N StyleHR sign-ins work today; N still
   find the same person by code`; `StyleHR sign-ins test mode would NOT find:
   0`.
5. **Post-deploy counts.** Expected values are from the rehearsal on the
   22-Oct-2026 dev snapshot; a fresh snapshot differs only by people added
   since, and the differences must agree with each other.
   ```sql
   select left(row_id, 4) as prefix, count(*) from person group by 1;   -- psn_ 275, Admi 1, Gues 1
   select count(*) from service_account;                                -- 0
   select count(person), count(service_account) from access_token;      -- 0, 0
   select count(*) from person_id_map;                                  -- 275
   select count(person), count(service_account) from has_role;          -- 276, 0
   select system, count(*) filter (where upper_inf(valid)) as current, count(*) as total
   from person_identifier group by 1;                                   -- stylehr-employee-code 271/271; email 11/11
   select subject_kind, count(*) from sign_in_identity
   where method = 'stylehr' and ended_at is null group by 1;            -- employee-code 271
   select max(name), count(*) from migration;                           -- see below
   select count(*) from information_schema.columns where table_schema = 'featherbase'
     and table_name = 'person' and column_name in ('employee_code', 'stylehr_username'); -- 0
   ```
   The migration row must match the release, not a fixed number: `max(name)` is
   the newest file in `apps/server/migrations` and `count(*)` is the number of
   files there (`ls apps/server/migrations | wc -l`) — with #408 and #411 on
   main that is `0107_drop_person_code_custom_fields.sql`, 108.
   Then `pnpm --filter server cli people:plan` (no `--rehearse`) on the live
   database: it re-scans the recorded map and must report no old id.
6. **Sign-in checks.** A trial user by their employee code (test mode) gets
   in; the Administrator by password gets in; a tab left open from before
   lands on the sign-in page saying the session ended.
7. **Record numbers.** Take a second snapshot first (same command,
   `…-pre-resolve-…dump`). Then
   `pnpm --filter server cli people:resolve <stylehr_record_ids.csv> --dry-run`
   (data-warehouse#4336's file: UTF-8, header
   `employee_code,assigner,stylehr_record_id`); read the report; run it again
   without `--dry-run`. It is one transaction; running it again moves
   nothing. Rehearsal with a **synthetic** file over the 271 snapshot codes:
   265 moved; 3 not in the file, 2 codes on two records, 1 record already
   another person's — all 6 keep working by code and are listed; second run:
   0 moved, 265 already moved; parity after it 271 / 271. Settle a listed one
   by hand (its Person form) or in the next file.
8. Close the window. After it, `pnpm --filter server cli seed-pack apply
   <instance-seed-pack>` is safe to run (idempotent). The roster sync stays **frozen**
   until data-warehouse#4336 rebuilds it on the identifier rows; the manual
   procedures below are in force until then.

### If something goes wrong in the dev window

- **Steps 3–4 refuse or fail** (boot-check error, preflight refusal, a failed
  migration in the 0100–0102 group): nothing has changed — the preflight runs
  before any migration, and 0100–0102 are one transaction. Confirm `select
  max(name) from migration` is still `0100_person_identities.ts` (dev's value;
  dev applied 0100 earlier), roll the service back to its previous deployment,
  and fix before trying again.
- **A later migration fails** (0104, 0105 or 0107): each runs in **its own
  transaction after the 0100–0102 group has committed**, so the database is
  NOT unchanged — `max(name)` shows the last one applied. Treat it as
  "released, but wrong" below: restore the step-2 snapshot. 0107 (#408) drops
  `person.employee_code` and `person.stylehr_username`; it fails if a
  publication's column list on `person` names either column, so no CDC
  publication column list may name them (check `select * from
  pg_publication_tables where tablename = 'person'` before the release).
- **Released, but wrong** (counts disagree, sign-in fails): take the service
  off the air, restore the step-2 snapshot —
  `pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" featherbase-dev-pre-person-<date>.dump`
  — check `select max(name) from migration` is `0100_person_identities.ts`
  and the stamp is `staging`, roll the service back to its previous
  deployment, and check a trial sign-in. Anything written between the deploy
  and the restore is lost; the window is closed to users, so there should be
  nothing.
- **Step 7 wrong** (a file that named the wrong records): restore the
  pre-resolve snapshot the same way; the release itself stays.

### Promoting to production

Prod deploys the **`production`** branch, and only with the owner's approval.
Prod is platform-only: it has no test mode and no StyleHR sign-in method, so
it skips the re-stamp, and 0102 writes no instance seed-pack rows. This is where the
CDC steps happen, because `<cdc-worker>` mirrors prod. The exact
operator commands for the warehouse side are in **data-warehouse PR #4339**
(draft, "DO NOT MERGE before…"), in the instance's private warehouse repository.

**What the warehouse receives after the switch.** `person` replaces `user`,
and **`identifier_system`** is mirrored (design D10). **`person_identifier`
stays denied until Phase 2.** `sign_in_identity`, `person_id_map`,
`service_account`, `person_identifier_fingerprint` and `person_merge` are
denied. On `has_role`, `person` / `service_account` are **stored generated
columns, which logical replication does not send**. Warehouse readers use
`parent` + `parenttype`.

1. **Rehearse** the CDC switch against a restored prod snapshot with 0100–0102
   applied (#4339): the worker freezes `access."user"`, baselines
   `access.person`, and reconciles row counts.
2. **Pause** `<cdc-worker>`. Write down its current schedule
   first, then set it to `0 5 29 2 *` (it fires only on 29 February), and
   confirm no run is in progress.
3. **Publication check.** The CDC publication covers `has_role`, which has
   REPLICA IDENTITY FULL; 0101 gives it stored generated columns, and on
   PostgreSQL 18 every UPDATE on it then fails (`42P10 … Replica identity must
   not contain unpublished generated columns`) unless the publication
   publishes them. Check `select pubname, pubgencols from pg_publication`:
   every publication covering `has_role` must show `s`. If not, run
   `ALTER PUBLICATION <name> SET (publish_generated_columns = stored)` (the
   data-warehouse CDC change sets it for `featherbase_cdc_pub`). A column
   list on `has_role` overrides that setting and cannot name 0101's columns
   yet, so publish `has_role` without one. The release preflight refuses
   otherwise, naming the publication and the fix.
4. **Snapshot prod** (`pg_dump -Fc --no-owner`); this is the rollback point.
   Then run `cli boot-check` in the prod service's environment: `environment
   production; test mode off`, and the preflight lines, including `no
   publication blocks updates on a table with stored generated columns` and
   the pending migrations 0100, 0101, 0101a, 0102.
5. **Promote:** merge to `production` (owner-approved); the release runs the
   preflight, then 0100 + 0101 + 0101a + 0102 in **one** transaction (prod is
   at 0099 before the release, so 0100 is part of it, #399).
6. **Counts** on prod, as in dev step 5 (no StyleHR rows: `person_identifier`
   holds only `email` rows), and `cli people:plan` on the live database
   reports no old id.
7. **Merge data-warehouse #4339** — only now — then run its `plan` and read
   it.
8. **Resume:** put back the schedule written down in step 2 and let one tick
   run.
9. **Verify:** `access.person` is baselined with as many rows as `select
   count(*) from person`; `access.identifier_system` is present;
   `person_identifier` and the denied tables are absent.
10. **Resnapshot** `data_scope`, `share` and `has_role`, so their rows carry
    the re-keyed ids.
11. **Drop the frozen `access."user"`** once the warehouse reads `access.person`
    (repoint any model still reading `access.user`, `has_role.person` or
    `data_scope.user`; none was found on 22-Oct-2026).

**If something goes wrong in production:** prod's ledger ends at
`0099_delegated_login_settings.ts` before the release, not 0100. If the
preflight refuses or any of 0100–0102 fails, the whole group rolls back:
confirm `select max(name) from migration` is still
`0099_delegated_login_settings.ts` and roll the service back; there is
nothing to restore. 0104, 0105 and 0107 each commit on their own after the
group: if one of them fails, the group and any earlier ones stay applied —
restore the step-4 snapshot as below. (On prod 0107 drops nothing — the
columns never existed there — but a publication column list on `person` must
still not name them.) If the release committed but is wrong: before step 7 (the
registration is unchanged), restore the step-4 snapshot (`max(name)` is then
`0099_delegated_login_settings.ts` again), roll the service back, put back
the schedule and let the worker resume on the old registration. After
step 7, restore the snapshot **and** revert #4339's registration change
before the worker runs again; then run one tick and check `access."user"` is
current again. If only a CDC tick fails, the release stays: pause the worker
again, fix the registration, and re-run the tick.
The step-3 `publish_generated_columns = stored` change can stay after a
restore: on the pre-release schema `has_role` has no generated columns, so it
publishes nothing extra and blocks nothing.

### Manual procedures while the roster sync is frozen (until data-warehouse#4336)

Until the roster feed writes its first employee code, a **System Manager** may
record or end an employee code by hand. Each such change needs a **note**, is
marked **recorded by hand** and **not verified**, and is still accepted by test
mode. A carried-over code is ended, never erased. The HR record number is never
typed by hand except as a sign-in link's subject. The hand path closes by itself
once the feed writes.

**Sections follow the employee code** (#408). Sales-target scoping reads each
person's **current StyleHR employee-code rows** (every one of them: two
payrolls give both codes' Sections). A hand entry, end or correction moves the
Sections at once. A code current on **two people** (two firms) scopes neither
of them **at all** (`no_assignment`, even for their other codes and their
explicit assignment rows); the server logs a `sales_target_ambiguous_employee_code`
warning naming the people and rows (never the code) — end the code on the
person who no longer holds it, on the Identifiers panel. Migration **0107** removed the old `employee_code` and
`stylehr_username` Custom Fields from Person (a no-op where they never existed,
such as prod); the warehouse mirror of `person` sees the two columns disappear.
A Custom Field named `employee_code` created on Person afterwards is **inert**:
nothing reads it, scoping included. **Importing people:** a Person file with an
`employee_code` (or `stylehr_username`) column is refused for that column — the
import wizard says "employee_code is no longer a Person field — add codes on the
Identifiers panel or with people:resolve", cannot map or tick it, and never
offers to create the field.

**Find a person by code:** *Admin → Person →* **Find by code**
(`/featherbase/admin/find-person`). Choose *StyleHR employee code* and type the
code exactly; an old code finds them too. Any Person picker also finds people
by code.

- **Leaver.** The HR contact mails the leaver's employee code. Find them,
  open the record and turn **Enabled** off: that ends every session and every
  way in at once (#371's rule), and deletes nothing. On the Identifiers panel,
  **End** the code with a note ("Left 23-Oct, HR mail") — always: a code left
  current on the leaver blocks the sales-target report of whoever is given
  that code next (a code current on two people scopes neither). Record the
  code and the date in the reply.
- **Joiner.** HR mails the employee code, the StyleHR login ID and the
  StyleHR record number. Find by code first — they may have worked here
  before. If they are not found, *Admin → Person → New*: full name, plus email
  if they have one. On the Identifiers panel add **StyleHR employee code**
  with a note ("Joiner, HR mail 23-Oct"). Under Sign-in methods link
  **StyleHR**: *Record number at the service* = the record number, *Login ID
  at the service* = their StyleHR login. Give roles and Data Scope as for
  their post. Their Sections follow the code at once; check *Sales target*
  opens on their Sections.
- **Correction** (a wrong code). On the person's Identifiers panel, **End** the
  wrong code with a note saying why; then add the right one with a note. The
  wrong one stays as history. If the wrong code belonged to someone else, add
  it to them the same way. The Sections move with the code: the wrong holder
  stops seeing them, and the right one sees them. A code recorded by hand by mistake on the same
  day can be removed instead.

## Smoke check

After a deploy: `SERVER_URL=https://... pnpm --filter server test:smoke`
asserts `GET /api/ping` answers `pong` with a live DB connection. Then
`POST /api/method/login` with valid credentials should return Frappe's
login shape (`{"message":"Logged In", ...}`), and in a single-origin
deployment `GET /` should answer the SPA's `index.html`.
