# Featherbase

A free and open-source, agent-first, self-hostable application framework and
runtime in TypeScript (React + Hono + Postgres). Define a **Table** once as
metadata: its storage, REST API, validation, access rules and generic UI derive
from that definition. Inspired by [Frappe Framework](https://frappe.io/framework),
and evolving to serve this platform's own users.

**Status:** pre-release, in active development. Work lives in GitHub issues and PRs.

## Getting started

Start with **Featherbase alone**. No example, client or test apps are built or
installed by the default startup. Choose apps deliberately afterwards; an
existing database keeps the apps and data you already installed.

### Windows, from a bare machine

1. Install [Node 26.13.0 LTS (Lithium)](https://nodejs.org/en/download) using the Windows `.msi`
   installer and [Git](https://git-scm.com/download/win). Use their default options.
2. Open PowerShell **as Administrator**. Node 26 does not bundle Corepack;
   install it, then enable pnpm:

   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
   npm install --global corepack@0.36.0
   corepack enable
   ```

   Answer `Y` if PowerShell asks about the execution policy.
3. Install [PostgreSQL](https://www.postgresql.org/download/windows/).
   Leave port `5432`, choose password `postgres` for this local trial, and skip
   Stack Builder. In Administrator PowerShell, check `Get-Service postgresql*`;
   if stopped, run `Start-Service postgresql*`.
4. Close that window. Open normal PowerShell and clone into a short path:

   ```powershell
   git config --global core.longpaths true
   mkdir C:\work
   cd C:\work
   git clone https://github.com/siraj-samsudeen/featherbase.git
   cd featherbase
   ```

5. Install dependencies, register this checkout's command once, then prepare
   the platform and start it:

   ```powershell
   pnpm install
   npm link --offline --ignore-scripts --package-lock=false
   featherbase
   featherbase setup
   featherbase start
   ```

   If Corepack asks to download the pinned pnpm, approve it during installation.
   Subsequent Featherbase commands do not ask interactive setup questions.

If your PostgreSQL password differs, create `.env.local` before setup:

```powershell
Set-Content .env.local "DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/featherbase"
```

URL-encode symbols in the password (`@` becomes `%40`, `#` becomes `%23`).
Keep credentials out of Git. These instructions are not a claim of testing on
a personal Windows machine; CI verifies the command surface separately.

### macOS and Linux

Install [Git](https://git-scm.com/downloads), [Node 26.13.0 LTS (Lithium)](https://nodejs.org/en/download)
and local PostgreSQL. On macOS, `brew install postgresql@18` then
`brew services start postgresql@18`. On Linux, use your distribution's package
and start its PostgreSQL service.

Create the local login if your installation lacks it:

```bash
# macOS / Homebrew
createuser -s postgres
psql postgres -c "ALTER USER postgres PASSWORD 'postgres'"

# Linux
sudo -u postgres psql -c "ALTER USER postgres PASSWORD 'postgres'"
```

Or put your own connection URL in `.env.local` (see `.env.example`). Then:

```bash
npm install --global corepack@0.36.0
corepack enable
git clone https://github.com/siraj-samsudeen/featherbase.git
cd featherbase
pnpm install
npm link --offline --ignore-scripts --package-lock=false
featherbase
featherbase setup
featherbase start
```

`npm link` registers **this clone**, not a published package or another download.
Run it once after installing dependencies; relink if you move the clone or want
to select a different checkout. The command reads that checkout's `.env.local`,
even when you invoke it from another folder. No shell/profile edits are needed.

If registration is unavailable (for example your global npm directory is not
writable), skip it and use the equivalent commands **from the checkout**:

```bash
pnpm featherbase setup
pnpm featherbase start
pnpm --silent featherbase health --json
```

If registration succeeded but your shell cannot find `featherbase`, reopen the
terminal or use this fallback. Do not run the platform itself as administrator
just to work around global-command permissions.

### Sign in and explore

Start prints the sign-in address (normally http://localhost:5173/featherbase/login).
Sign in as `Administrator` with password `admin`, **development only**. Follow
the welcome guide for personal administrator setup. Apps and shared-instance
readiness are separate choices, not prerequisites for exploring locally.
Ctrl-C stops both servers. Setup is safe to repeat: it creates the local database
if missing, runs pending platform migrations, and preserves existing data.

From a second terminal:

```bash
featherbase health
featherbase health --json
```

Health reuses the server's checks. Exit `0` means ready to explore; exit `1`
means an operational fault or missing required setup. Optional configuration is
reported separately. With the pnpm fallback, add `--silent` when stdout must
be only JSON. Help needs no database: `featherbase --help`, or add `--help`
to any action.

### Configuration and troubleshooting

All three actions use `.env.local` at the repository root. Real environment
variables win; blank values use defaults. Default database: `featherbase` on
`127.0.0.1:5432`, user/password `postgres`; API port `8000`, web port `5173`.
Setup and start are local-development operations, not production deployment.
Health can inspect the environment selected by the operator without mutating it.

| Problem | Next action |
|---|---|
| `corepack` not found | Use Node 24, or install Corepack with `npm install -g corepack`. |
| `corepack enable` fails with permissions | Use Administrator PowerShell on Windows. |
| Postgres cannot be reached | Start PostgreSQL, then repeat setup. |
| Postgres refuses the login | Set the correct `DATABASE_URL` in `.env.local`. |
| A port is already in use | Stop the earlier instance or choose `API_PORT` / `WEB_PORT` in `.env.local`. |
| Windows paths too long | Enable Git long paths and clone into a short folder such as `C:\work`. |
| Health reports a fault | Follow that check's next action, then rerun health. |

### Explicit opt-in: a named client instance

The development shortcut `pnpm dev` also starts only Featherbase. To build,
install and configure the apps of a named instance, name it explicitly:

```bash
featherbase start jeyarama/dash
# Or, to see Feather Dash using made-up data instead of a real warehouse:
featherbase start jeyarama/dash --made-up-data
```

The existing `pnpm dev jeyarama/dash --made-up-data` shortcut remains available.
Named instances live at `client-apps/<client>/instances/<instance>/instance.json`.
They default to database `fb_<client>_<instance>`, unless `DATABASE_URL` overrides
it. Their declared apps are built/installed and their settings file is applied.
`--environment dev` selects a different settings section; `--made-up-data` is
local-only and substitutes made-up app secrets. It never connects to a warehouse.
`--check` proves startup and stops, for either base or named instances.

Advanced administration is grouped by purpose:

```bash
featherbase advanced --help
featherbase advanced people --help
featherbase advanced apps install-app <explicit-app-name>
```

There is no public marketplace or automatic download of unreviewed code.

### Explicit opt-in: Feather Tickets

Tickets is a separate product app in `example-apps/tickets`, not the Helpdesk
sample. Build it with `npm ci --prefix example-apps/tickets` followed by
`npm run build --prefix example-apps/tickets`. Add that folder's absolute path
to the JSON array `FEATHERBASE_APP_PATHS` in your untracked `.env.local`, restart
the server, then choose Tickets in app administration (or run
`featherbase advanced apps install-app tickets`). Ordinary startup does not
install it or create sample requests.

Requesters share public ticket summaries and progress. Original request details
stay with the submitter and support; employee verification and investigation
evidence remain support-only. Give staff the `Tickets Support` role and configure
the app's settings with person IDs, not display names: `support_users`,
`verification_admins` and `fulfillment_admins` are JSON arrays; `approval_routes`
maps regions to arrays of alternative approvers; `restricted_resources` is a
JSON array of restricted resource names. Missing authority or routing blocks
access decisions. Use the existing App Setting/instance-settings interface.

For an explicitly disposable, local development instance only:

```bash
node tools/seed-tickets-development.mjs --url=http://127.0.0.1:8000
```

This opt-in walkthrough creates fictional people and requests through the real
server. It refuses remote destinations, non-development databases and queues
containing real requests. It never connects to StyleHR, email, MotherDuck or
GitHub. Stage one records manual verification, decisions, fulfillment and
investigation; live integrations are a separate stage.

### Boot and smoke-test for contributors

`./init.sh` installs checkout dependencies, bootstraps local Postgres where
supported, migrates the platform and smoke-tests the running stack. It does not
prepare or install apps. In an Amp orb it starts the stack under the orb service
supervisor so it survives pause/resume. Use the printed portal for browser access.
Outside an orb it retains the local background-server boot path.

Tests that install runtime packages must prepare fixtures explicitly:

```bash
pnpm apps:prepare
pnpm test
```

Tests normally use their own `featherbase_test` database, not development data.
See [docs/TESTING.md](docs/TESTING.md) for the individual suites and acceptance runner.

## Commands

```bash
pnpm check:dev                   # startup and public command-surface tests
pnpm test                        # workspace suites (prepare app fixtures first)
pnpm smoke                       # server + web smoke tests against running stack
pnpm --filter server typecheck   # also: pnpm --filter web typecheck
pnpm check:specs                 # OpenSpec specifications and active changes
```

## Source map

| Path | What lives there |
|---|---|
| `apps/server` | Hono API, Table engine, auth, jobs, printing |
| `apps/web` | Generic metadata-driven UI |
| `packages/shared` | Shared contracts and types |
| `example-apps` | Shipped optional apps, including Tasker |
| `test-apps` | Explicit test packages, not user apps |
| `client-apps` | Client apps and named-instance settings ([ADR 0014](adr/0014-one-repo-for-platform-and-apps.md)) |
| `openspec/specs` | Behaviour specifications, the sole authority |
| `adr` | Architectural decisions and their rationale |
| `tools` | Checkout commands and CI checks |

## Docs

- [docs/VISION.md](docs/VISION.md): purpose and audience
- [CONTEXT.md](CONTEXT.md): vocabulary
- [docs/TESTING.md](docs/TESTING.md): testing
- [docs/DEPLOY.md](docs/DEPLOY.md): deployment (production has no default password)
- [docs/PREVIEW.md](docs/PREVIEW.md): previews
- [adr/](adr/): architectural decisions
- [openspec/specs/](openspec/specs/): behaviour specifications
- [CLAUDE.md](CLAUDE.md): contributor protocol

Featherbase is part of the [Feather family](https://github.com/siraj-samsudeen/feather-framework).
MIT licensed.
