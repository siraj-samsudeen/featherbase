# Deploying Featherbase

How to run the server in production. `./init.sh` remains the development
boot and is unchanged.

## The two-step boot

Every deploy is **release, then serve** — never the reverse, and never both
in one process:

```sh
# 1. Release: apply migrations. Run ONCE per deploy, before any
#    new-code instance serves traffic.
pnpm --filter server release

# 2. Serve: the API server, no file watcher.
PORT=8000 pnpm --filter server start
```

The release step takes a Postgres advisory lock
(`hashtext('featherbase-release')`) for its whole run, so N instances that
all execute it on boot serialize instead of racing. It runs a **preflight**
before the first migration (`src/release-preflight.ts`: environment stamp,
test mode, required variables, `INSTANCE_ADDRESSES`, sign-in methods, and
every installed, enabled app); any refusal stops the release before it has
changed anything. Each migration then
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
| `CLIENT_ADDRESS_HEADER` | no | no |  | one request header the edge overwrites with the client's address (Railway's edge sets `X-Real-IP` and `X-Forwarded-For`), recorded on each sign-in and used for the pre-auth budgets. Set it only when the edge replaces the caller's copy; see [Behind a proxy](#behind-a-proxy) |
| `RATE_LIMIT_WINDOW_MS` | no | no | `60000` | per-user API rate-limit window |
| `RATE_LIMIT_MAX` | no | no | `100000` | per-user API requests per window, unless the person has their own limit |
| `DELEGATED_LOGIN_TEST_MODE` | **never in production**: development, test and staging only | no |  | `trust-any-password` lets a linked account sign in by its employee code without a password, to try a rollout as any linked Team Leader. Any other value is ignored |
| `ALLOW_MOCK_OAUTH` | **never outside development and test** | no |  | `1` turns on the mock Google provider, which mints a session for any typed email from a pre-auth endpoint. For development and the test suites |
| `PREVIEW_LOGIN_KEY` | **never in production**: development, test and staging only | yes |  | preview deployments: the one-link sign-in's secret, 32+ characters. See [PREVIEW.md](PREVIEW.md) |
| `PREVIEW_LOGIN_USER` | **never in production**: development, test and staging only | no |  | preview deployments: the account the link signs in as (never Administrator) |
| `PREVIEW_USER_NAME` | no | no |  | preview deployments: the full name the pre-deploy step gives the preview person (default `Preview Visitor`) |
| `DISABLE_DATABASE_ENVIRONMENT_CHECK` | no | no |  | `1` skips the check that the database was stamped by this environment. Break-glass only |
| `FEATHERBASE_APP_PATHS` | no | no | `[]` | JSON array of extra app package directories to discover at boot; `<folder>/*` means every folder in it |
| `FEATHERBASE_INSTANCE` | no | no |  | the client instance this image was built for (`<client>/<instance>`), as a build argument and a variable. Set, the pre-deploy step installs or upgrades its apps and applies its settings. See [A client instance](#a-client-instance) |
| `JOB_POLL_MS` | no | no | `500` | background worker poll interval |
| `SERVER_URL` | no | no | `http://localhost:8000` | the server `pnpm smoke` probes |
| `MOTHERDUCK_TOKEN` | no | yes |  | MotherDuck access for the sales-target embed and warehouse reads; never logged, returned or stored |
| `MOTHERDUCK_API_BASE` | no | no | `https://api.motherduck.com` | MotherDuck API base |
| `MOTHERDUCK_EMBED_ORIGIN` | no | no | `https://embed-motherduck.com` | the embed sandbox origin, framed by the Sales Target page alone (#642); overridable only for a local stub |
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
presentation, never a security boundary. With https addresses listed, every
sign-in cookie is `Secure`, so signing in over plain http (an unlisted host
such as the container's own IP) silently fails: use a listed address.

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

### A client instance

A client instance (`client-apps/<client>/instances/<instance>/`, ADR 0014) is
built and deployed from this repository. Name it in one variable; the image and
the pre-deploy step do the rest:

```sh
docker build -f apps/server/Dockerfile --build-arg FEATHERBASE_INSTANCE=<client>/<instance> -t my-instance .
```

The image holds the apps its `instance.json` lists, each in
`/app/instance-apps/<app>-<version>/`, and the instance's folder, and sets
`FEATHERBASE_APP_PATHS` to `["/app/instance-apps/*"]`. Without the build argument
the image is the default one, and the `platform` target stays app-free.

With `FEATHERBASE_INSTANCE` set, `pnpm --filter server pre-deploy` runs, in order,
stopping at the first problem so that the old deployment keeps serving:

1. the release (preflight, migrations);
2. each app the image ships: install it if missing, upgrade and activate it if a
   newer version ships;
3. the settings file's section for this environment: `staging` applies `dev`,
   `production` applies `prod`. Any other environment refuses (`pnpm dev` is for a
   developer's machine);
4. on `staging` only, re-pin an app whose files changed (below).

**Variables.** The table above, and for a client instance:

| Variable | Why |
| --- | --- |
| `FEATHERBASE_INSTANCE` | `<client>/<instance>`; Railway passes it to the build as well, because the Dockerfile declares the `ARG` |
| `FEATHERBASE_ENV` | `staging` for its dev, `production` for its prod |
| `PORT` | `8000` on Railway, matching the port of its domain |
| `RAILWAY_DOCKERFILE_PATH` | `apps/server/Dockerfile`, on Railway (see [Railway](#railway)) |
| `DATABASE_URL`, `JWT_SECRET`, `INSTANCE_ADDRESSES`, `ADMIN_PASSWORD` | as for any instance, with its own values |
| every `{ "env": "NAME" }` in the settings section | a missing one fails the deploy, naming it |
| `GOOGLE_CLIENT_SECRET` | when the section enables Google sign-in with a client id; missing, the deploy fails, naming it |
| the `url_env` of each Data Source, and each app's declared secrets | missing, the deploy warns, and only what needs them refuses |

**Which code each environment runs.**

| | Dev (`staging`) | Prod (`production`) |
| --- | --- | --- |
| Branch the service builds | `main` | `release/<client>-<instance>-prod` |
| An app's files changed, same version and manifest | re-pinned automatically | **the deploy fails**: bump the version |
| An app's manifest changed, same version | the deploy fails, naming the app: bump the version | the same |
| A newer app version | upgraded | upgraded |

So moving prod is merging into its release branch, whose history is the deploy
log. `cli repin-apps` is the re-pin by hand. It refuses a production server or
database.

**Upgrading needs both versions in the image.** An upgrade replays the installed
version's declaration, and that exact version must ship or the release refuses.
So the release PR that bumps an app adds the version it replaces to `instance.json`,
naming a source archive of the commit that released it; the build rebuilds it from
there (`tools/build-instance-apps.mjs`):

```json
"previousVersions": [{ "path": "client-apps/<client>/<app>", "version": "1.0.0",
                       "archive": "https://codeload.github.com/<owner>/<repo>/tar.gz/<commit>" }]
```

**Watch paths**, so that a service rebuilds only for what is in its image. On
Railway they are set per service, and `.railway/railway.ts` records them for
the environments it manages. `.railway/**` is not one of them: Railway doesn't
read it during a deploy.

```text
apps/**
packages/**
pnpm-lock.yaml
tools/dev.mjs
tools/build-instance-apps.mjs
client-apps/<client>/instances/<instance>/**
<each app path in its instance.json>/**
```

### Building your own client image

A client whose app lives in its own repository builds on the published platform
image instead. The rest of this section is that path.

There the app reaches the server in a **client image built on the platform
image**. This repository publishes that platform image to the GitHub Container Registry as a public
package (made public by hand once; see below):

- `ghcr.io/siraj-samsudeen/featherbase-server:<full commit SHA>`: one tag per
  commit on `main`, published only after that commit's `test` workflow passed
  (`.github/workflows/publish-image.yml`). Pin this one.
- `ghcr.io/siraj-samsudeen/featherbase-server:main`: follows `main`. It is
  moved to a commit's image only while that commit is still main's tip, so it
  never goes back to an older commit, but it can lag a merge or two behind. It
  moves, so never deploy from it.

**Once, after the first publish:** GHCR creates a new package as private. A
person must make it public, because neither the workflow nor its
`GITHUB_TOKEN` can change a package's visibility. On the package page, open
Package settings → Change visibility → Public. Then check that a pull works
without credentials:

```sh
docker logout ghcr.io
docker pull ghcr.io/siraj-samsudeen/featherbase-server:<sha>
```

Until then, a client build fails at its `FROM` line with an authentication
error (`unauthorized` or `denied`) from `ghcr.io`, even though the tag exists.
(Done for this package on 27-Oct-2026.)

**The image is built for `linux/amd64` only**, the platform Railway runs. On an
Apple-silicon Mac, a plain `docker pull` answers "no matching manifest for
linux/arm64"; pull and run with `--platform linux/amd64` (Docker emulates it,
more slowly), and build a client image the same way:

```sh
docker pull --platform linux/amd64 ghcr.io/siraj-samsudeen/featherbase-server:<sha>
docker build --platform linux/amd64 -t my-client-image .
```

It is the Dockerfile's `platform` target: the server, the built SPA and the
start command, with **no app** and no `FEATHERBASE_APP_PATHS`. Its
`dev.featherbase.platform-versions` label lists the platform versions it runs
apps on (`SUPPORTED_PLATFORM_VERSIONS`); an app's `platformVersion` must be one
of them. It is built for `linux/amd64`.

The client's repository holds a small Dockerfile. A made-up example, for an app
called `acme_board` built into `build/acme_board/<version>/`:

```dockerfile
FROM ghcr.io/siraj-samsudeen/featherbase-server:0123456789abcdef0123456789abcdef01234567

# Every version installed on any instance, each in its own directory, so an
# instance on the older one finds its exact artifact and can upgrade.
COPY build/acme_board/1.0.0 /app/client-apps/acme_board-1.0.0
COPY build/acme_board/1.1.0 /app/client-apps/acme_board-1.1.0
ENV FEATHERBASE_APP_PATHS='["/app/client-apps/acme_board-1.0.0","/app/client-apps/acme_board-1.1.0"]'
```

Each directory holds the app's `package.json`, `featherbase.json` and the
built files its manifest names. **An image that leaves out a version still
installed and enabled on the instance is refused:** the release stops before
its first migration, naming the app and version, so the deployment already
running keeps serving it. The server's start and `cli boot-check` refuse the
same way, except on a `development` server, which starts with the app
unavailable and warns how to bring it back. A disabled app never blocks a
release. The start command, `NODE_ENV` and port come
from the platform image; the release step and `cli boot-check` run in the
client image exactly as described above.

**Moving an instance to a newer platform.** Bump the SHA in the `FROM` line in
a pull request on the client's repository, and let its host rebuild on merge.
The pull request is the record of which platform each instance runs. Before
bumping, check that the new image's `dev.featherbase.platform-versions` label
still lists the app's `platformVersion`
(`docker inspect --format '{{ index .Config.Labels "dev.featherbase.platform-versions" }}' <image>`).

### Railway

**The settings live on the service.** Railway reads no file from the
repository when it deploys. A service left at Railway's defaults builds with
Railpack and runs no pre-deploy step, so the server starts on an empty database
and crashes. Each service needs:

| Setting | Value |
| --- | --- |
| Builder, Dockerfile path | `DOCKERFILE`, `apps/server/Dockerfile` |
| Pre-deploy command | `pnpm --filter server pre-deploy` |
| Healthcheck path, timeout | `/api/ping`, `300` |
| Restart policy | `ON_FAILURE`, 5 retries |
| Volume | mounted at `/data` |

`.railway/railway.ts` (Railway's Infrastructure as Code, which replaced
`railway.json`) holds them for each environment, beside what differs between
environments: the service's name, its volume and its watch paths. To bring an
environment into line, or to check it, run from the repo root with the
[Railway CLI](https://docs.railway.com/cli) (5.49.1 or newer) signed in:

```sh
railway link --project jeyarama-featherbase --environment <environment>
railway config plan     # reads only; lists what an apply would change
railway config apply    # asks for confirmation of that same list
```

A plan that lists nothing means the environment already matches. Apply only
when the plan lists only the changes you meant. The file is a named partial
(`featherbase-server`), so it manages only the server service and its volume.
Without the partial name, an apply would delete every resource the file leaves
out, the database included. Inside the service, a setting the file leaves out
is one an apply clears, which is why the source and volume are declared.
Variables are never managed by the file: secrets stay on Railway. An
environment the file doesn't name is refused. Add it to `ENVIRONMENTS` first.
A new environment's service gets these settings from that apply, or by hand.

The pre-deploy command, `pnpm --filter server pre-deploy`, runs the release, then
[a client instance's apps and settings](#a-client-instance) when
`FEATHERBASE_INSTANCE` is set, then the preview seed, which does nothing unless
the preview variables are set. Any of them failing fails the deploy. Keep the
pre-deploy step one command (a test pins it): Railway may run each entry as argv rather than
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
   to point it at the copy without exporting `DATABASE_URL`). It refuses a
   database other sessions are connected to, because that looks like the live
   instance, not the copy: the rehearsal holds each migration's locks until it
   ends. Stop anything else connected to the copy, or pass `--allow-live` if
   you truly mean it. The check only sees sessions that are connected now: a
   live server whose connections have all gone idle and closed looks like a
   copy, so check the address too. A migration that waits more than 2 seconds
   for a lock fails the rehearsal instead of queueing, and no one statement
   may run longer than 5 minutes; on a very large copy a migration that
   rewrites a lot can hit that limit in the rehearsal although the release
   has none.
5. `pnpm --filter server release` on the copy, then check the data the
   migration rewrites.

### The baseline

Every instance is a fresh install: a new instance starts from
`0001_baseline.sql`, the platform's schema and starting rows in one step. The
two steps after it read the instance's own variables (`ADMIN_PASSWORD` for the
first Administrator, `ALLOW_MOCK_OAUTH` for the local Google mock). Later
changes ship as new numbered migrations and apply in order.

The release refuses a database that has no Featherbase ledger
(`featherbase.migration`) but is not empty, before anything changes: point it
at a new database instead. There is no path from an older installation; one
is wiped and installed fresh.

The baseline is generated, never edited:
`pnpm --filter server baseline:generate` migrates a scratch database and
writes it again (`apps/server/scripts/generate-baseline.ts` says what it
leaves out and why). Run on the same migrations, it writes the same file.

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

After a **fresh or restored database**, a client instance's next deploy does
this by itself ([A client instance](#a-client-instance)). Otherwise, install the instance's apps
(`pnpm --filter server cli install-app <name>`; an app's settings need the app
installed), then apply the instance settings file once
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
  is refused. While `ADMIN_PASSWORD` is set but is not the live password, the
  release and `cli boot-check` print a warning (never either value).
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

The same address is recorded on each sign-in's Activity Log entry. An edge
with no fixed addresses to list, such as Railway's, can instead name one header
it overwrites with the client's address in `CLIENT_ADDRESS_HEADER` (Railway's
edge sets `X-Real-IP` and `X-Forwarded-For`). The server believes that header
only when it holds exactly one address. A list, a malformed value or a missing
header falls back to the socket peer. Set it only when the edge replaces the
caller's copy rather than appending to it, and only when every route to the
server passes through that edge (a sibling service on a private network could
otherwise name any address). Check it on each instance after setting it:

```bash
curl -s -X POST https://<instance address>/api/login \
  -H 'content-type: application/json' -H 'X-Forwarded-For: 203.0.113.9' \
  -d '{"usr":"<your username>","pwd":"<your password>"}' > /dev/null
```

Send it again with `X-Real-IP: 203.0.113.9` too. Then open the Activity Log.
Each new sign-in must show your own public address. Anything else is a failed
check: the forged `203.0.113.9` means the edge passes the caller's header
through, and an internal address means the header held a list. Try the other
header, or unset the variable.

## Instance settings

An instance's non-secret settings are kept in one reviewed file,
`client-apps/<client>/instances/<instance>/instance-settings.json`, beside the
`instance.json` that lists which apps it runs. It
manages `System Settings` (any field, e.g. `app_name`, `time_zone`,
`privacy_notice`, `invitation_email_intro`), `Sign In Method` rows by `row_id`,
and `Scheduled Job` rows (`enabled` only), and installed apps' declared
settings as `App Setting` rows (`row_id` `<app>.<setting>`, `value` only), and
`Data Source` rows by `row_id`, which name the variable holding the connection
(`url_env`) and never the connection itself. A reflected Table comes back by
reflecting from the restored source (the source's `reflect` action); the row does
not create it.
Values that differ by environment go in that environment's section; when the
file has sections, every apply must name one. Secrets never go in it: an app's
declared secrets are deployment variables, set like any other.

A value can come from a variable: `{ "env": "DIVE_ID" }` wherever a value goes.
It is read when the file is applied (by the `settings:apply` process, or sent in
the API's `env` field; the server never reads its own environment for a file),
saved into the Table and locked as usual. A missing or empty variable is a listed
problem naming it, in a dry run too. Output, logs and the drift report never show
the value, and the last apply remembers where it came from: `settings:export`
writes `{ "env": "DIVE_ID" }` back, and replacing it with a plain value shows the
old one as `[the value of DIVE_ID]`. A file that stops naming the field keeps it
private until someone changes the value. A variable that holds a secret is refused.

```bash
F="$PWD/client-apps/<client>/instances/<instance>"   # absolute: the command runs inside apps/server
pnpm --filter server cli settings:apply --file "$F/instance-settings.json" --environment dev --dry-run
pnpm --filter server cli settings:export --dir "$F"   # start the file from a running environment
```

A workflow can apply it with a System Manager service account's token (`POST /api/instance-settings/apply`, same body
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
each enabled app has its required settings and secrets; Administrator not on
the default password.

### Comparing environments

Dev and prod drift silently: a variable set on one and not the other, a
secret shared where it must differ, or a settings file applied to one
environment only. A workflow can compare them on each
run. It picks a fresh key, asks every environment for its variable report
with that key, and puts the reports side by side:

```bash
set -euo pipefail
KEY=$(openssl rand -hex 32)   # new every run; never stored (in Actions, ::add-mask:: it)
for env in dev prod; do        # each with its own System Manager service-account token
  printf '{"key":"%s"}' "$KEY" | curl --fail-with-body "https://<$env host>/api/instance-settings/variables" \
    -H "Authorization: Bearer <$env token>" -H 'Content-Type: application/json' \
    --data @- > "$PWD/$env.json"
done
pnpm --silent --filter server cli settings:compare dev="$PWD/dev.json" prod="$PWD/prod.json"
```

A report says, for every declared variable, whether it is set, and for the
secrets with a cross-environment rule (the "must differ" `DATABASE_URL`,
`JWT_SECRET` and `FILE_URL_SECRET`; the "must match" `GOOGLE_CLIENT_SECRET`)
a 16-digit HMAC-SHA256 of the value under that run's key. It also names the
settings-file revision and section last applied, and whether the settings
still match it. No value leaves the server. A new key each run means
fingerprints cannot be collected and matched across runs, and are useless
without that run's key. Whoever holds the key could still test guesses
against them, so keep these secrets long and random. From a shell on the server (for
example over `railway ssh`), `printf %s "$KEY" | pnpm --silent --filter server
cli settings:variables --stdin` prints the same report. (`pnpm --filter`
runs the command in `apps/server`, so give report files as absolute paths.)

The comparison prints one line per variable that any environment sets, then
the settings file:

```text
Variable                 dev                 prod                 Result
DATABASE_URL             set                 set                  ok
INSTANCE_ADDRESSES       unset               set                  PROBLEM: set on prod only; dev needs it
JWT_SECRET               set                 set                  PROBLEM: the same on dev and prod; it must differ between environments
GOOGLE_CLIENT_SECRET     set                 set                  ok
SMTP_HOST                unset               set                  note: set on prod only
Settings file revision   4f0c2a91b7de (dev)  4f0c2a91b7de (prod)  ok
Settings match the file  yes                 no                   PROBLEM: changed outside the file on prod
3 problems, 1 note.
```

It exits 1 while there is a problem: a rule broken, a variable missing on an
environment that needs it (required or recommended there as its release
judges it, such as the Google secret where Google sign-in is on; a
`development` environment needs almost nothing), an environment never applied, applied
from another revision, or applied with another environment's section, or
settings changed outside the file. A note (a variable set on one side only
that the other does not need, such as real email on prod, or an apply with no
revision recorded) is for reading, not failing. Reports made with different keys are
refused. Values that should differ, such as each environment's own web
addresses, are compared by presence only.

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
note. Find a person with *Admin → Person
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

An app's role suggestions (`roleDefaults`) become App Role Binding rows once,
at install; an upgrade never writes them again, so a binding an admin removed
stays removed. Edit bindings in Admin (*App Role Binding*); a binding to `All`
or `Guest` is refused, and a release that finds one refuses to start.

Back up first. **After the upgrade commits, restoring the old code alone is not
recovery:** restore the exact target artifact and activate it. There is no
down migration. A lost response is safe to retry with the same version and
`planId`. Never use a reset or demo seed as an application migration.
