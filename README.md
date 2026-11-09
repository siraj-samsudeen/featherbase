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

**Start clean:** stop Featherbase, preview with `featherbase reset`, then run
`featherbase reset --yes; if ($LASTEXITCODE -eq 0) { featherbase setup }` in PowerShell.

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

**Start clean (macOS and Linux):** stop Featherbase, preview with `featherbase reset`,
then run `featherbase reset --yes && featherbase setup`.

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

### Prototype with native components

Before inventing a control, browse `/gallery.html` on the development server.
Search by name/purpose; each working specimen names its source. Import shared
controls from `@featherbase/shop-floor` (`packages/shop-floor/src`), with `src/index.css` and the native
query/router/theme providers. `TabBar` is phone navigation; `ContentTabs` is
full-content section navigation. `Breadcrumbs` accepts context-preserving links.
`SearchableList` searches an entire supplied collection, not a loaded page of
remote results. Its render callback can mount `DataList`; cell callbacks accept
real `TextInput`/`Select` controls, so an editable mapping needs no second grid.

For the resettable synthetic starter, run from this checkout:

```bash
pnpm --filter web exec vite --config vite.prototype.config.ts
```

Open `/prototype.html` on the printed address (default port 5373; override
`PROTOTYPE_PORT`). In an Amp orb, run that command as a supervised service and
share its portal. The prototype server needs no database or credentials and has
**no live API proxy**. Unknown API/file/socket actions are refused. Its separate
origin holds synthetic identity and in-memory records; never enter real tokens.
Normal dev-server launch refuses to initialize this entry. Production builds
include neither its entry nor its fixtures.

`src/gallery/prototype-main.tsx` is the composition point: pass a React screen
to `createPrototypeRouter` from `PrototypeApp.tsx`. It uses actual `AdminLayout`
with opt-in wide content; normal routes keep their existing sizing. Use generic
`ListView`/`FormView` for metadata Tables, `DataList` for non-Table collections.
`fixtures.ts` defines Lab Project and related Lab Task metadata/records. Scenario
controls change their responses to populated/empty/loading/error/permission-limited;
Reset data restores synthetic records, not planning-note drafts. Give every new
long collection visible search and keep return context in breadcrumbs/URLs.

For integration, keep those same screen imports, define the corresponding Table
through the existing API, and open it on the **normal isolated development API**.
Do not add a live-forwarding switch to fixture mode. The scenario tests in
`apps/web/test/scenarios/native-prototype-library.test.tsx` compare native
field order, labels and types across both origins, then save and reload the
real form. Synthetic approval is not proof of permissions, persistence,
concurrency or deployment readiness. Grow this library from consumer needs;
do not fork native renderers or build a second design system.

### Configuration and troubleshooting

All actions use `.env.local` at the repository root. Real environment
variables win; blank values use defaults. Default database: `featherbase` on
`127.0.0.1:5432`, user/password `postgres`; API port `8000`, web port `5173`.
Setup, start and reset are local-development operations, not production deployment.
Health can inspect the environment selected by the operator without mutating it.

### Reset only the selected local instance

`featherbase reset [<client>/<instance>] [--yes]` uses the same database selection
as start: no name defaults to `featherbase`; `jeyarama/dash` defaults to
`fb_jeyarama_dash`. An explicit `DATABASE_URL` overrides either default.
Without `--yes`, reset prints the database, absolute storage path and file count,
changes nothing and exits `1`. Confirmation removes that database and isolated
uploads only, then says `Next: featherbase setup`; setup is never automatic.
For a named instance, use `featherbase start <client>/<instance>` afterwards to
prepare and install its declared apps again.

Reset requires a loopback database URL without query options, a development
process environment and the database's actual persisted `development` stamp.
It refuses unstamped, test, staging and production databases even when the process
says development; there is no override. Stop connected servers or database clients
first: refusal lists PostgreSQL backend PIDs and application names, and kills nothing.

Local commands now select uploads under `apps/server/storage/instances/<identity>`,
where identity derives from the selected host, port and database, not the login
password. Routing query overrides (`host`, `port`, `database`) are refused by every
local command before assigning storage; put these in the URL authority/path.
Non-routing options such as `sslmode` retain their setup/start/health semantics.
Setup prints the absolute path. Different local databases no longer share
uploads. **Existing uploads under `apps/server/storage/public` and `private` are
not moved, copied or deleted**: another database may still use them. Existing File
records will not find those old files in the new isolated directory. To continue
using an old database with its old uploads, explicitly set `FILE_STORAGE_DIR` in
`.env.local` to that old folder's absolute path. This retains the old shared-storage
behavior, so reset refuses it. Unset that override only when deliberately choosing
the new isolated storage and a clean reset. No legacy-file ownership is inferred
from one database's records. Hosted storage configuration is unchanged.

Reset also refuses custom storage paths and symbolic links rather than assume
ownership. A database drop and filesystem deletion cannot be one transaction;
if filesystem permissions prevent cleanup after the drop, the command fails and
reports that no setup ran. Keep the printed path when diagnosing that failure.

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
# Or, to see Dash using made-up data instead of a real warehouse:
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

From a checkout, an app is found only on `FEATHERBASE_APP_PATHS`. To try Tasker,
build it with `pnpm apps:prepare`, then set
`FEATHERBASE_APP_PATHS='["<absolute checkout>/example-apps/tasker"]'` for both
`install-app tasker` and `start`. Membership is the **Tasker Member** role on a Person;
installing admits nobody. The default image already carries Tasker on that path.

There is no public marketplace or automatic download of unreviewed code.

### Explicit opt-in: Feather Tickets

Tickets is a separate product app in `example-apps/tickets`, not the Helpdesk
sample. Build it with `npm ci --prefix example-apps/tickets` followed by
`npm run build --prefix example-apps/tickets`. Add that folder's absolute path
to the JSON array `FEATHERBASE_APP_PATHS` in your untracked `.env.local`, restart
the server, then choose Tickets in app administration (or run
`featherbase advanced apps install-app tickets`). Either takes effect at once,
with no second restart; if the app cannot run, the Apps screen and every
Tickets request say why. Ordinary startup does not install it or create
sample requests.

An instance adds its own ticket types without a release: a System Manager
adds a row to Tickets' *Ticket type* Table (its states, one per line, the
first being where a ticket starts; its done states; the state a reopened
ticket returns to; optional routing) and one *Ticket type field* row per
field (text, long text, choice, date, person or link). A link field reads an
instance Table only when that Table is listed in the `linked_tables` setting,
and always with the requester's own permissions.

Requesters share public ticket summaries and progress. Original request details
stay with the submitter and support; employee verification and investigation
evidence remain support-only. Give staff the `Tickets Support` role and configure
the app's settings with person IDs, not display names: `support_users`,
`verification_admins` and `fulfillment_admins` are JSON arrays; `approval_routes`
maps regions to arrays of alternative approvers; `restricted_resources` is a
JSON array of restricted resource names. `assignees` is a JSON array of people
support may assign tickets to without giving them support rights; the assign
picker also offers everyone in the other lists. Assigning a ticket to someone
else emails them, once the save commits; creating a ticket never sends mail.
Missing authority or routing blocks
access decisions. Use the existing App Setting/instance-settings interface.

Tickets uses ordinary platform Table permissions: Administrator and System
Manager retain privileged read access. The `Tickets Support` role grants private
reads independently of action membership; removing someone from an action
setting alone does not revoke that role's read access. A private ticket's
assignee and the person it is raised for read its request through a read-only
share of that one row, which Tickets resets whenever either changes.

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
See [docs/TESTING.md](docs/TESTING.md) for the individual suites and spec scenarios.

### Connect an agent

An agent (Claude Code, Codex, any MCP client) reaches Featherbase at `/mcp` on the
API's address, with one of your access tokens. It acts as you: it reads and changes
only what you may, and history marks each change it makes with the token's label.
Issue a token under your account's access tokens (or `POST /api/access_tokens` with
`{ "label": "Claude on my laptop" }`), then:

```bash
# Claude Code
claude mcp add --transport http featherbase http://localhost:8000/mcp \
  --header "Authorization: Bearer fbt_…"
```

```toml
# Codex: ~/.codex/config.toml
[mcp_servers.featherbase]
url = "http://localhost:8000/mcp"
bearer_token_env_var = "FEATHERBASE_TOKEN"   # export FEATHERBASE_TOKEN=fbt_…
```

Use your instance's `API_PORT` (or its public address) in place of `8000`. The
tools: `list_tables`, `describe_table`, `query_rows`, `get_row`, `create_row`,
`update_row`, `delete_row`.

## Commands

```bash
pnpm check:dev                   # startup and public command-surface tests
pnpm test                        # workspace suites (prepare app fixtures first)
pnpm smoke                       # server + web smoke tests against running stack
pnpm --filter server typecheck   # also: pnpm --filter web typecheck
pnpm check:specs                 # OpenSpec specifications and active changes
pnpm check:audit                 # no high or critical advisory in production dependencies
```

## Source map

| Path | What lives there |
|---|---|
| `apps/server` | Hono API, Table engine, auth, jobs, printing; `/mcp` for agents (`src/mcp.ts`) |
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
