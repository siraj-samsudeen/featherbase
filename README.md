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

```bash
./init.sh
```

One script boots everything. It installs dependencies, provisions Postgres if
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
| `runtime-apps` | Applications packaged for the runtime (e.g. `tasker`) |
| `client-apps` | Apps built for one client, one folder per client (`jeyarama/dash`); their instances' settings live in each client's private repository ([ADR 0014](docs/adr/0014-one-repo-for-platform-and-apps.md)) |
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
