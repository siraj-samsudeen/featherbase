# Contributing to Featherbase

## Prerequisites

- **Node** — a current LTS. There is no `engines` pin or `.nvmrc`; the code
  is ESM with top-level `await` (see `apps/server/src/index.ts`), so
  anything recent enough for `tsx` works.
- **pnpm 10** — the repo pins `pnpm@10.33.0` via the `packageManager` field
  in the root `package.json` (Corepack picks this up automatically).
- **Postgres** — reachable at `DATABASE_URL`, which defaults to
  `postgres://postgres:postgres@127.0.0.1:5432/featherbase`
  (`apps/server/src/config.ts`). You usually don't need to set anything up
  by hand: `./init.sh` provisions it (below). Nothing runs on 5433 and
  there is no `.pgdata` directory.
- For e2e tests and server-side PDF printing, Playwright resolves its own
  installed Chromium; set `CHROMIUM_PATH` only if you need a specific
  binary (`apps/web/playwright.config.ts`, `apps/server/src/print.ts`).

## Getting a running stack

```bash
./init.sh
```

One script boots everything. Step by step (read `init.sh` itself — it's
heavily commented):

1. **Dependencies** — installs pnpm if missing, runs `pnpm install` if
   `node_modules` is absent.
2. **Database** — probes `DATABASE_URL` first and never touches a Postgres
   that already answers. Only if the probe fails does it try to start a
   cluster (Debian `pg_ctlcluster`, macOS `brew services`) and create the
   role/database over whichever superuser connection the host accepts.
3. **Migrations + patches** — `pnpm --filter server migrate` then
   `pnpm --filter server patches`. Migrations live in
   `apps/server/migrations/` (numbered SQL and TS files).
4. **App servers** — kills stale listeners on ports **8000** (API) and
   **5173** (web) by port, starts both dev servers (logs at
   `/tmp/featherbase-server.log` and `/tmp/featherbase-web.log`), waits for
   both to answer, and asserts the answering PIDs are the ones it started —
   so another checkout's stack can't masquerade as yours.
5. **Smoke test** — `pnpm smoke` (server smoke + the web `e2e/smoke.spec.ts`).

Re-running `./init.sh` is safe and mostly a no-op once things are up.

**Log in** at http://localhost:5173 as `Administrator` / `admin`. The
default password is set by `apps/server/migrations/0006_admin_password.ts`;
override with the `ADMIN_PASSWORD` environment variable at first migration.

## Running tests

See [docs/TESTING.md](docs/TESTING.md) for the how and why (the SQL-sandbox
model, why files run sequentially). The short version:

```bash
pnpm test                                        # every suite
pnpm --filter server test                        # server integration suite
pnpm --filter server test test/naming.test.ts    # a single file
pnpm --filter web test                           # web component suite
pnpm --filter web e2e                            # Playwright e2e — stack must be running
pnpm smoke                                       # quick server + web smoke
pnpm --filter server typecheck
```

Two suites have extra environment hooks:

- **RLS suite** (`apps/server/test/rls.test.ts`) opens a second connection
  as the `desk_client` Postgres role (created by
  `apps/server/migrations/0010_rls.sql`, password `desk_client`). Default
  URL `postgres://desk_client:desk_client@127.0.0.1:5432/featherbase`;
  override with `RLS_TEST_URL`.
- **e2e** targets `http://localhost:5173` (override with `WEB_URL`), so run
  `./init.sh` first.

## Working conventions

The repo is developed session-by-session with a standing protocol (the full
version is in `CLAUDE.md`; `PROGRESS.md` is the running log):

1. **Orient** — read the newest `PROGRESS.md` entry and recent git log
   before starting.
2. **Boot and smoke-test first** — `./init.sh`, verify login → list → form
   works before writing code. If the app is broken, fixing it is the task.
3. **One piece of work per session**, implemented fully — small, complete,
   working — then verified end-to-end (real HTTP calls, real browser), not
   just unit tests.
4. **Record it** — append a dated entry to `PROGRESS.md` (what, how
   verified, what's next), commit at every stable point, and leave the tree
   clean and the app booting.

A few hard rules worth knowing before your first PR:

- Everything derives from DocType metadata — never hand-write a per-model
  table, endpoint, or form component.
- The Frappe wire shapes (`sid` cookie, `/api/method/login` response,
  `exc_type` error bodies) are deliberate compatibility surface; don't
  "clean them up".
- New UI must inherit the Desk look — the design tokens and `.fc-*`
  component classes (rules at the top of `PROGRESS.md`).
- Don't edit entries in `harness/features.json` beyond flipping a `status`.
- `feather-testing-postgres` lives in its own repo; fix it there and bump
  the dependency, never vendor it back in.

## Finding your way around

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the request lifecycle,
  metadata engine, and a map of the source tree
- [docs/TUTORIAL.md](docs/TUTORIAL.md) — build your first DocType end to end
- [docs/TESTING.md](docs/TESTING.md) — the SQL-sandbox test model
- [docs/GLOSSARY.md](docs/GLOSSARY.md) — Frappe vocabulary decoded
- [docs/adr/](docs/adr/) — why things are the way they are; start with
  [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md)
