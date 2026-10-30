# Featherbase

A free and open-source, agent-first, self-hostable application framework and
runtime in TypeScript (React + Hono + Postgres). You define a **Table** once as
metadata, and its storage, REST API, validation, access rules and Admin UI are
all generated from that one definition. It began as a replication of
[Frappe Framework](https://frappe.io/framework)'s core ideas and now diverges
from Frappe wherever that serves its own users better.

**Status:** pre-release, in active development. Current work lives in the
GitHub issues and pull requests.

## Getting started

Prerequisites:

- **Node**, a current LTS release.
- **pnpm 10.** The root `package.json` pins `pnpm@10.33.0`, and Corepack picks
  it up.
- **Postgres**, reachable at `DATABASE_URL`. The default is
  `postgres://postgres:postgres@127.0.0.1:5432/featherbase`, or
  `featherbase_test` when tests run (`apps/server/src/config.ts`).

To run an instance, one command does everything from a bare checkout:

```bash
pnpm dev:jeyarama          # the same as: pnpm dev jeyarama/dash
```

It needs only Node, pnpm and a running Postgres, on Windows, macOS or Linux. It
creates the database (`fb_jeyarama_dash`), installs and builds what the
instance's apps need, migrates, installs the apps, applies the settings, and
starts the API and the web app with reload. It prints where to go and how to sign
in. Run it again whenever you like. Ctrl-C stops everything.

An instance is a folder, `client-apps/<client>/instances/<instance>/`, whose
`instance.json` lists its apps. Optional settings go in `.env.local` at the
repository root (see `.env.example`), and a real variable wins: `DATABASE_URL`
(on this machine only), `API_PORT`, `WEB_PORT`. `--check` stops after proving
the server answers and the apps are installed; `--environment dev` applies that
section of the settings file instead of `local`, and needs the variables that
section names.

### Windows

From a bare machine:

1. Install **Node** (the LTS installer) and **Git**.
2. In a terminal run as Administrator: `corepack enable`. That provides pnpm 10.
3. Install **PostgreSQL** with the [installer](https://www.postgresql.org/download/windows/).
   Use `postgres` as the password, or put your own login in `.env.local`:
   `DATABASE_URL=postgres://postgres:YOUR_PASSWORD@127.0.0.1:5432/fb_jeyarama_dash`.
   Its service starts by itself; if it is stopped, start it in **Services**.
4. Clone with long paths on: `git clone -c core.longpaths=true <this repository>`.
5. Run `pnpm dev:jeyarama`, in PowerShell or Command Prompt.

`AGENTS.md` and `.claude/skills/*` are symbolic links. Without symlink support Git
checks them out as small text files, which breaks nothing here. `./init.sh` and the
other `.sh` scripts are bash, for macOS and Linux; `pnpm dev` does not use them.

### The platform on its own

```bash
./init.sh
```

One script boots everything and smoke-tests it. It installs dependencies, provisions Postgres if
nothing answers at `DATABASE_URL`, runs migrations, starts the API on
http://localhost:8000 and the web app on http://localhost:5173, then runs the
smoke tests. Running it again is safe.

Sign in at http://localhost:5173 as `Administrator` with the password `admin`.
That default exists only in development and test; production has none (see
[docs/DEPLOY.md](docs/DEPLOY.md)).

## Commands

```bash
pnpm test                        # every suite
pnpm smoke                       # server + web smoke tests
pnpm --filter server typecheck   # also: pnpm --filter web typecheck
pnpm check:specs                 # validate OpenSpec specs and active changes
```

## Source map

| Path | What lives there |
|---|---|
| `apps/server` | Hono API: Table engine, REST API, auth, jobs, printing |
| `apps/web` | React Admin UI: one metadata-driven list and form for every Table |
| `packages/shared` | Types and contracts used by both server and web |
| `example-apps` | Apps shipped with the platform (`tasker`) |
| `test-apps` | Small app packages the tests install to prove one platform feature each (`other`, `action-proof`, `scope-proof`, `fixtures/`); not examples to copy |
| `client-apps` | Apps built for one client, one folder per client (`jeyarama/dash`), with each instance's settings under `instances/` (`jeyarama/instances/dash`; [ADR 0014](docs/adr/0014-one-repo-for-platform-and-apps.md)) |
| `openspec/specs` | Behaviour specs, the sole authority on what the system does |
| `docs/adr` | Architecture decisions and why they were made |
| `tools` | Repository checks run in CI (`pnpm check:*`) |

Tests run inside real Postgres transactions that are rolled back, using
[feather-testing-postgres](https://github.com/siraj-samsudeen/feather-testing-postgres).

## Docs

- [docs/VISION.md](docs/VISION.md): what this is for and who it serves
- [CONTEXT.md](CONTEXT.md): the project's vocabulary
- [docs/TESTING.md](docs/TESTING.md): how the test suites are built and run
- [docs/DEPLOY.md](docs/DEPLOY.md): deploying an instance
- [docs/PREVIEW.md](docs/PREVIEW.md): preview deployments
- [docs/adr/](docs/adr/): architecture decisions
- [openspec/specs/](openspec/specs/): behaviour specs
- [CLAUDE.md](CLAUDE.md): the standing protocol for coding agents

Featherbase is part of the
[Feather family](https://github.com/siraj-samsudeen/feather-framework).
MIT licensed.
