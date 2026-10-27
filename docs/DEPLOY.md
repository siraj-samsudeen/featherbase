# Deploying Featherbase

How to run the server in production. `./init.sh` remains the development
boot and is unchanged.

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
all execute it on boot serialize instead of racing. It runs a **preflight**
before the first migration (`src/release-preflight.ts`: environment stamp,
test mode, required variables, `INSTANCE_ADDRESSES`, sign-in methods); any
refusal stops the release before it has changed anything. Each migration then
runs in its own transaction; the release exits non-zero on the first failure
without recording the failed step, so the next release retries it. The
release also prints the [instance health](#instance-health) checks; a failing
check never stops it.

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
start only warn, and every query against that source refuses, naming the
variable.

<!-- generated:variables:start — from apps/server/src/env.ts by `pnpm --filter server generate:env`; do not edit -->

| Variable | Required | Secret | Default | Purpose |
| --- | --- | --- | --- | --- |
| `FEATHERBASE_ENV` | **yes**, this or `NODE_ENV`, for a release | no | `NODE_ENV`, then `development` | which environment this process is: `production`, `staging`, `development` or `test`; it wins over `NODE_ENV`. The release (and `cli boot-check`) refuses when neither is set (#430). Only `development` and `test` allow zero-setup Administrator credentials |
| `NODE_ENV` | no | no | `development` | read only when `FEATHERBASE_ENV` is unset (Vitest sets it to `test`) |
| `DATABASE_URL` | **yes**, outside development and test | yes | local `featherbase` (`featherbase_test` under test) | Postgres connection string. `db.ts` sets `prepare: false`, which transaction-mode poolers (such as Supabase on port 6543) require (must differ across environments) |
| `PORT` | no | no | `8000` | HTTP and WebSocket port |
| `WEB_ORIGINS` | no | no | `http://localhost:5173,http://127.0.0.1:5173` | comma-separated CORS allowlist; needed only when the SPA is served from another origin |
| `INSTANCE_ADDRESSES` | **yes**, outside development and test | no |  | a JSON array saying what each web address of this instance opens (`admin` or an app) and which one emailed links use. See [Instance addresses](#instance-addresses). Unset (development and test only), the server falls back to the request, trusting the first `x-forwarded-proto` hop |
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
| `SMTP_NAME` | no | no |  | the `EHLO` hostname. Unset, the domain of `MAIL_FROM`, then the host of the `INSTANCE_ADDRESSES` entry marked for emails, then the sender's domain |
| `PREAUTH_WINDOW_MS` | no | no | `900000` | pre-auth fixed window, in milliseconds |
| `PREAUTH_LOGIN_MAX` | no | no | `60` | password and delegated sign-in submissions per source and window |
| `PREAUTH_PASSWORD_MAX` | no | no | `5` | per provider, username and source |
| `PREAUTH_OAUTH_LOGIN_MAX` | no | no | `30` | OAuth initiations per source and window |
| `PREAUTH_OAUTH_CALLBACK_MAX` | no | no | `30` | OAuth callbacks per source and window |
| `PREAUTH_FORM_MAX` | no | no | `30` | public web-form POSTs per source and window |
| `PREAUTH_SIGNUP_MAX` | no | no | `10` | sign-ups per source and window |
| `PREAUTH_HANDOFF_MAX` | no | no | `200` | steps of the hand-off between instance addresses per source and window; each hand-off takes two, apart from the Google buckets |
| `TRUSTED_PROXY_IPS` | no | no |  | comma-separated exact socket IPs trusted to append `X-Forwarded-For` |
| `RATE_LIMIT_WINDOW_MS` | no | no | `60000` | per-user API rate-limit window |
| `RATE_LIMIT_MAX` | no | no | `100000` | per-user API requests per window, unless the person has their own limit |
| `DELEGATED_LOGIN_TEST_MODE` | **never in production**: development, test and staging only | no |  | `trust-any-password` lets a linked account sign in by its employee code without a password, to try a rollout as any linked Team Leader. Any other value is ignored |
| `ALLOW_MOCK_OAUTH` | **never outside development and test** | no |  | `1` turns on the mock Google provider, which mints a session for any typed email from a pre-auth endpoint. For development and the test suites |
| `PREVIEW_LOGIN_KEY` | **never in production**: development, test and staging only | yes |  | preview deployments: the one-link sign-in's secret, 32+ characters. See [PREVIEW.md](PREVIEW.md) |
| `PREVIEW_LOGIN_USER` | **never in production**: development, test and staging only | no |  | preview deployments: the account the link signs in as (never Administrator) |
| `PREVIEW_USER_NAME` | no | no |  | preview deployments: the full name the pre-deploy step gives the preview person (default `Preview Visitor`) |
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

### Instance addresses

`INSTANCE_ADDRESSES` is a JSON array, read at boot before the database. Each
entry is one web address of this instance:

```json
[{ "address": "https://dash.example.com", "opens": "feather_dash", "emails": true },
 { "address": "https://featherbase.example.com", "opens": "admin" }]
```

- `address` is an absolute origin with no path, `https` outside development
  and test. Each host appears once (the port is not part of the match).
- `opens` is `admin` (the Admin screens) or an app's name. At least one entry
  opens `admin`.
- Exactly one entry has `"emails": true`. Invitations and password resets
  link to it, and its host is the `EHLO` fallback.

The server refuses to start on a bad list, and the release preflight refuses
when it is unset outside development and test. A request's `Host` only
*selects* a listed entry; every absolute URL the server builds (the Google
`redirect_uri`, cookie `Secure`, emailed links) comes from the list. Each
address keeps its own sign-in (the `sid` cookie is host-only). An address is
presentation, never a security boundary.

**Register every address with Google.** Google sign-in on each address uses
`<address>/api/oauth/google/callback` as its `redirect_uri`. In the Google
Cloud console, open the OAuth client (the one whose id is in the `google` Sign
In Method row) → **Authorized redirect URIs**, and add that URI for **every**
entry of `INSTANCE_ADDRESSES` before the release that lists it. A missing one
gets Google's `redirect_uri_mismatch` error.

### Environments and the database stamp

`FEATHERBASE_ENV` names the environment, and the database is **stamped** with
it (`internal_metadata.environment`); the migrator refuses a database stamped
for another environment. **`staging` is the environment of a hosted trial
instance** (dev): it admits test mode (`DELEGATED_LOGIN_TEST_MODE`) and preview
sign-in, and is production in every other respect. `development` is *not* safe
on a public host — it gives a null Administrator hash the known password
`admin`. A database labelled `production` never runs with test mode, even with
the stamp check overridden.

To change an instance's environment, re-stamp it once: set the new
`FEATHERBASE_ENV` **and** `DISABLE_DATABASE_ENVIRONMENT_CHECK=1`, redeploy the
current release, then remove `DISABLE_DATABASE_ENVIRONMENT_CHECK` (never leave
it set). Check `/api/ping` answers the new `"environment"` and `select value
from internal_metadata where key = 'environment'` agrees.

`cli boot-check` (read-only) runs the server's start-up refusal and the
release preflight with this process's environment and `DATABASE_URL`, one
line per check; any refusal is a non-zero exit. Run it in the target service's
own environment before a deploy:

```sh
railway ssh -p <project> -e <env> -s <service> -- pnpm --filter server cli boot-check
```

## Hosting

### Container

`apps/server/Dockerfile` is a minimal, vendor-neutral image. Build from the
repo root so the pnpm workspace resolves:

```sh
docker build -f apps/server/Dockerfile -t featherbase-server .
docker run --rm -e DATABASE_URL=$DATABASE_URL featherbase-server pnpm --filter server release
docker run -d -e DATABASE_URL=$DATABASE_URL -e JWT_SECRET=$JWT_SECRET -p 8000:8000 featherbase-server
```

Any platform that runs a container and can execute a pre-deploy command fits
this shape.

### Single-origin deployment (SPA in the image)

The Dockerfile's `web-build` stage compiles `apps/web` and ships `dist/`
inside the server image. When that directory exists, `index.ts` serves the SPA
with an index-html fallback, so **one container answers both `/` and `/api`
on one origin**, with `/ws` and the file routes alongside; `WEB_ORIGINS` is
then irrelevant. The server-owned prefixes (`/api`, `/files`,
`/private/files`, `/web`, `/ws`) never fall through to `index.html`.

### Railway

`railway.json` at the repo root encodes this shape: Dockerfile build, a
pre-deploy step of `pnpm --filter server pre-deploy` (the release, then the
preview seed, which does nothing unless the preview variables are set; either
failing fails the deploy), and `/api/ping` as the healthcheck. Keep the
pre-deploy step one command: Railway may run each entry as argv rather than
through a shell, and a second command chained with `&&` was observed never to
run while the deploy still went green (#307). Other platforms map the same
settings onto their own vocabulary. Turn on the host's **deploy-failure
notification** for each environment (Railway: project notification settings,
deploy failed, to the owners): a failed release leaves the old code serving,
and nothing inside Featherbase can report a release it never ran.

### The web SPA, separately hosted

`apps/web` can be served by any static host (`pnpm --filter web build` →
`dist/`). It reads no build-time variables and talks to the API on its own
origin, so that host must reverse-proxy `/api`, `/ws` and `/files` to the
server, and the server needs `WEB_ORIGINS` set to that origin. Prefer the
single-origin image.

### Preview deployments

Two extra variables (`PREVIEW_LOGIN_KEY`, `PREVIEW_LOGIN_USER`) give a
one-link sign-in as an ordinary named user; without them the route 404s and
the deploy-time seed does nothing. Runbook: [PREVIEW.md](PREVIEW.md).

## Migrations and rehearsal

Migrations live in `apps/server/migrations` and are applied by the release
step. **A migration that rewrites the trial's data is rehearsed first on a
restored snapshot of the target, with the target's real environment
variables:**

1. `pg_dump -Fc --no-owner` the target and restore it into a local Postgres of
   the same major version.
2. Export the target's variables exactly as it has them (`FEATHERBASE_ENV`,
   `DELEGATED_LOGIN_TEST_MODE`, `ALLOW_MOCK_OAUTH`, `ADMIN_PASSWORD` set or
   not, …), with only `DATABASE_URL` pointing at the copy.
3. `pnpm --filter server cli boot-check` — "the server will start", then the
   preflight lines.
4. Run every pending migration in one rolled-back transaction:
   `pnpm --filter server cli migrate:rehearse` (or add `--database-url <dsn>`
   to point it at the copy without exporting `DATABASE_URL`)
5. `pnpm --filter server release` on the copy, then check the data the
   migration rewrites.

### Pending: script API rename `featherbase` (0124)

The object Server Scripts and Client Scripts call is now `featherbase`
(`featherbase.throw(msg)`, `featherbase.ui.form.on(table, handlers)`); the
runtimes no longer define `frappe`. Migration **0124** rewrites the stored
`script` source of every Server Script and Client Script, replacing `frappe.`
member access with `featherbase.` (other names that contain the word are left
alone). It rewrites the trial's data, so rehearse it as above, then compare
each changed script before and after (`select row_id, script from
server_script` / `client_script`). A script that still fails afterwards with
"frappe is not defined" builds the name some other way (for example
`var f = frappe`) and needs editing by hand.

## Backups and rollback

**Snapshot before every deploy that has pending migrations** — this is the
rollback point:

```sh
pg_dump -Fc --no-owner "$DATABASE_URL" > featherbase-<env>-pre-<release>-<YYYY-MM-DD>.dump
pg_restore -l featherbase-<env>-pre-<release>-<YYYY-MM-DD>.dump | head   # the file must list featherbase tables
```

Keep it until the release is signed off.

- **The preflight refuses, or the first pending migration fails:** nothing
  has changed. Check `select max(name) from migration` still shows the
  pre-release value, roll the service back to its previous deployment, and
  fix before trying again.
- **A later migration fails, or the release committed but is wrong:** earlier
  migrations of the release stay applied. Take the service off the air and
  restore the snapshot:

  ```sh
  pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" featherbase-<env>-pre-<release>-<YYYY-MM-DD>.dump
  ```

  Check `max(name)` and the environment stamp are back to their pre-release
  values, roll the service back to its previous deployment, and check a
  sign-in. Anything written between the deploy and the restore is lost.

After a **fresh or restored database**, apply the instance settings file once
(see [Instance settings](#instance-settings)); until then the environment runs
on defaults.

## Smoke check

After a deploy: `SERVER_URL=https://... pnpm --filter server test:smoke`
asserts `GET /api/ping` answers `pong` with a live DB connection. Then sign in
with valid credentials, and in a single-origin deployment `GET /` should
answer the SPA's `index.html`.

## First admin

A fresh production database has **no default password**. With no nonblank
`ADMIN_PASSWORD`, Administrator's password hash stays null, so password login
is unavailable. The release warns when no enabled human System Manager has a
password. Provision a named manager on the production box:

```sh
pnpm --filter server cli create-person <email> <password> --roles "System Manager"
# or, for one who signs in with Google (put the flag last; it takes no value):
pnpm --filter server cli create-person <email> --roles "System Manager" --expects-google-sign-in
```

Give that manager an email address: system notices go to enabled System
Managers with an address, and Administrator has none. Alternatively, set
`ADMIN_PASSWORD` before the first release; if migrations already ran with
Administrator locked, set it and run `pnpm --filter server cli seed`. Neither
release, migrations nor seed overwrites an existing password hash, so setting
`ADMIN_PASSWORD` later is **not password rotation** (see
[Rotating credentials](#rotating-credentials)). Administrator is a break-glass
account, not a daily login.

### Locked out

When no System Manager can sign in, reset a password from an operator shell.
The password is read from **stdin only**, must be at least 6 characters, ends
every session of that person, revokes their emailed reset links and is logged
(actor `cli`). Access tokens survive it.

```sh
read -rs PW && printf '%s\n' "$PW" | \
  railway ssh -p <project> -e <env> -s <service> -- \
  pnpm --filter server cli set-password Administrator --stdin; unset PW
```

The CLI refuses a terminal on stdin. If `railway ssh` allocates a TTY or does
not forward stdin, open an interactive `railway ssh` shell and run the
`read … | pnpm --filter server cli set-password <person-id> --stdin` there.
`<person-id>` is `Administrator` or a `psn_…` id.

## Rotating credentials

Rotate each credential on **each** environment separately (dev first, then
production). The pattern: create the new value in the secret store, set it,
restart, verify, and only then revoke the old one. Never paste a value onto a
command line or into a log. A variable change reaches the server only on
restart, and every instance of a service must carry the same value.

- **Administrator and other passwords.** Changing `ADMIN_PASSWORD` does not
  change a live password. Use the password UI or
  `<read-from-secret-store> | pnpm --filter server cli set-password <person-id> --stdin`
  ([Locked out](#locked-out) shows the remote pipe), then set `ADMIN_PASSWORD`
  to the new value or remove it. Verify the new password works and the old one
  is refused.
- **Access tokens** (`fbt_…`) are unaffected by password or `JWT_SECRET`
  changes. `pnpm --filter server cli list-tokens [<principal>]`, then
  `cli issue-token <principal> --label "<purpose>" [--expires <days>]` (prints
  the secret once), update every consumer, then `cli revoke-token <old-id>`.
- **`JWT_SECRET`** signs every session: changing it ends every session (and
  in-flight Google sign-ins and private-file links). Use a long random value
  (`openssl rand -base64 48`), change it in a quiet window and restart all
  instances together.
- **Database password.** Change it in Postgres or the provider, and point every
  consumer's `DATABASE_URL` at one **reference variable** (Railway:
  `${{<db-service>.DATABASE_URL}}`) so each picks it up on redeploy. Verify each
  consumer with `cli boot-check` or `GET /api/ping`.
- **Google OAuth client secret.** The client id lives in the `google` Sign In
  Method row; add a new secret in the Google Cloud console, set
  `GOOGLE_CLIENT_SECRET`, restart, sign in with Google once, then delete the
  old secret.
- **`SMTP_PASSWORD`.** Create a new app password, set it, restart, run
  `pnpm --filter server cli mail:test <your-address>`, then revoke the old app
  password at the provider.

Order after a suspected leak: passwords of Administrator and every System
Manager, access tokens, `JWT_SECRET`, the Google secret and `SMTP_PASSWORD`,
the database password last. To compare a deployed value with the secret store
without printing either, compare `printf %s "$VALUE" | sha256sum | cut -c1-12`
on both sides.

## Automation credentials

Scripts, CI and manifest installs authenticate with **access tokens** owned by
a service account, bootstrapped over SSH:

```sh
pnpm --filter server cli create-service-account svc-installer --roles "System Manager"
#   → created service account svc_… ("svc-installer")
pnpm --filter server cli issue-token svc_… --label "manifest installs"
```

`issue-token` prints the `fbt_…` secret **once**; store it in the secret
manager and send it as `Authorization: Bearer fbt_…`. Tokens are listable,
revocable and also managed under *Admin → Access tokens*; disabling the
service account ends all its tokens.

## Email

With `SMTP_HOST` unset, every outbound message lands in the Email Sink. Set
`SMTP_HOST` and the same messages leave through that SMTP server. Production
uses `smtp-relay.gmail.com` on port 587; TLS and certificate checks are always
required. The variables are in the [Configuration](#configuration) table.

**Google Workspace SMTP relay.** Admin console: **Apps → Google Workspace →
Gmail → Routing → SMTP relay service → Configure** — allowed senders: only
addresses in my domains; require SMTP Authentication; require TLS. Then set
`SMTP_HOST=smtp-relay.gmail.com`, `SMTP_PORT=587`, `SMTP_USER`,
`SMTP_PASSWORD` and `MAIL_FROM`. The `SMTP_USER` account needs 2-Step
Verification to create an **app password**, which is `SMTP_PASSWORD`. The
relay can take up to an hour to accept a new configuration, and refuses an
`EHLO` name that is not a fully qualified domain (`ECONNECTION 421`); the
`MAIL_FROM` domain is used by default.

**Check it:**

```sh
pnpm --filter server cli mail:test <your-address>
# → mail:test: sent a test message via SMTP smtp-relay.gmail.com:587
```

On failure it exits 1 with `Mail delivery failed (<code> …)` and prints the
relay's reply with addresses and the password masked. `EAUTH` = wrong user or
app password; `ETLS`/`ESOCKET`/`ECONNECTION` = TLS or network; `EENVELOPE` =
a rejected sender or recipient; `ECONFIG` = a bad setting. Every delivery
failure also writes one `mail_delivery_failed` log line with no address or
credential.

## Behind a proxy

Public routes (sign-in, OAuth, public web forms, the address hand-off) are
rate-limited by source with counters in Postgres shared by every instance, so
deploy all instances with the same configuration and database. By default the
socket peer is the source and forwarded headers are ignored. Behind a proxy,
list the proxy's exact socket IPs in `TRUSTED_PROXY_IPS` and make sure it
appends `X-Forwarded-For` correctly. Tune the `PREAUTH_*` budgets for staff who
share one public IP.

## Instance settings

An instance's non-secret settings are kept in one reviewed file in the
instance's own private repository, `featherbase/instance-settings.json`. It
manages `System Settings` (any field, e.g. `app_name`, `time_zone`,
`privacy_notice`, `invitation_email_intro`), `Sign In Method` rows by `row_id`,
and `Scheduled Job` rows (`enabled` only). Values that differ by environment go
in that environment's section; when the file has sections, every apply must
name one. Secrets never go in it.

```bash
pnpm --filter server cli settings:apply --file featherbase/instance-settings.json --environment dev --dry-run
pnpm --filter server cli settings:export --dir featherbase/   # start the file from a running environment
```

The instance repository's workflow applies it on merge with a System Manager
service account's token (`POST /api/instance-settings/apply`, same body
fields). An apply is one transaction: any problem lists every problem and
changes nothing; `--dry-run` / `"dry_run": true` writes nothing.
`pnpm --filter server cli settings:set <field> --stdin` is the break-glass
path for one text field (for example
`cli settings:set privacy_notice --stdin < privacy-notice.md`); check
`https://<host>/privacy` afterwards, and if the file does not reach the remote
command, paste it into the System Settings form instead.

### Instance health

**Admin → This instance → Instance health**
(`/featherbase/admin/instance-health`) lists every check, and a banner shows
on every Admin page while one fails. The release prints the same checks, and
the `check_instance_health` job runs them every 15 minutes. Checks: a System
Manager with an email address; recommended variables set; settings file
applied; settings match the file; each enabled scheduled job ran recently;
Administrator not on the default password.

## Sign-in methods and linked identities

The ways in are rows of the system Table **Sign In Method** (Admin → Sign In
Method, System Managers only): `password`, `google`, and delegated-password
rows such as `stylehr`. Google uses the row's `client_id`; the secret is
`GOOGLE_CLIENT_SECRET`. Featherbase refuses any change that would leave an
enabled Administrator or System Manager with no way in. **Keep sign-up
closed** until what the `All` role can read has been audited. People are
linked to outside accounts by the provider's permanent ID, from the Person
form's Sign-in methods panel or `POST /api/people/<person>/identities`.

**StyleHR delegated sign-in.** As a System Manager, add a Sign In Method row:
`row_id` `stylehr`, kind `delegated_password`, label `StyleHR`, service URL
`https://stylehr.in/api/login/` (keep the trailing slash: StyleHR redirects
without it, and a redirected POST loses its body). Another HR system is a new
row with its own `settings` JSON, not code.

**`DELEGATED_LOGIN_TEST_MODE=trust-any-password` lets anyone sign in as any
linked staff member by employee code, with no password.** It is allowed only
on `development`, `test` and `staging`; never set it where real users sign in,
and remove it at the end of the trial.

### People records while the roster sync is frozen

Until the roster feed (data-warehouse#4336) writes employee codes, a System
Manager records them by hand on the Person's **Identifiers** panel, each with a
note. Bulk employee-code to StyleHR record-number files go through
`pnpm --filter server cli people:resolve <csv> --dry-run`, then again without
`--dry-run` (one transaction; idempotent). Find a person with *Admin → Person
→* **Find by code** (`/featherbase/admin/find-person`).

- **Leaver.** Find them, turn **Enabled** off (ends every session and way in),
  and **End** their employee code with a note — a code left current blocks
  whoever is given it next, because a code current on two people scopes
  neither.
- **Joiner.** Find by code first. Otherwise *Admin → Person → New*; add the
  **StyleHR employee code** on the Identifiers panel; under Sign-in methods
  link **StyleHR** with the record number and login ID; give roles and Data
  Scope. Check *Sales target* opens on their Sections.
- **Correction.** **End** the wrong code with a note and add the right one;
  Sections move with the code.

## Runtime application upgrades

The behaviour contract is `openspec/specs/trusted-runtime-packages/spec.md`.
An upgrade is **Preview → Upgrade → Activate**, by a System Manager, never
install-again or reset.

Unpack each app release into its own durable, immutable directory, set
`FEATHERBASE_APP_PATHS` to a JSON array of both the prior and the target
directories (for example `["/data/apps/tasker/0.0.1","/data/apps/tasker/2.0.0"]`,
on a Railway volume), and restart. Overwriting the directory baked into the
image is **not** a safe upgrade. `/api/apps` reports versions, pending
activation and discovery failures.

```sh
curl --fail-with-body "$BASE/api/preview_app_upgrade" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"<app>","version":"<version>"}'
curl --fail-with-body "$BASE/api/upgrade_app" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"<app>","version":"<version>","planId":"<reviewed planId>"}'
curl --fail-with-body "$BASE/api/activate_app_upgrade" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data '{"name":"<app>","version":"<version>"}'
```

Back up first. **After the upgrade commits, restoring the old code alone is not
recovery:** restore the exact target artifact and activate it. There is no
down migration. A lost response is safe to retry with the same version and
`planId`. Never use a reset or demo seed as an application migration.
