# Featherbase — Agent Instructions

You are building a metadata-driven low-code app platform on a JS/TS stack.
The project started by replicating [Frappe Framework](https://frappe.io/framework)
faithfully — that phase is complete, the stack and architecture inspiration
remain credited to Frappe, and much of the design below still traces back to
it. The project is now in a deliberate second phase, diverging from Frappe's
design (vocabulary and API shape included) where it doesn't serve this
platform's own users. Read `docs/ROADMAP.md` for the strategy and
`docs/adr/` for the decisions already made. This file is your standing
protocol — follow it every session.

The project was developed under the working name `frappe-clone` and became
Featherbase in July 2026. That name survives only in dated `PROGRESS.md`
entries and in `docs/research/frappe-architecture.md`, where `frappe_clone` is
a *filesystem path* to an upstream Frappe checkout — unrelated to this project
and not to be renamed.

## Project stage — experimental, nothing is deployed

**This product is not deployed anywhere and has no users. Everything is free
to change.** There is no install base, no production database, no external
consumer of any URL, API shape, table name, or wire format. Treat every
interface as provisional.

So: when a name, route, schema, or contract is wrong, **change it outright**.
Do not add redirects, aliases, deprecation shims, compatibility flags, or
dual-write paths to preserve the old shape — that is machinery paid for by a
migration burden this project does not have, and it leaves the retired shape
in the codebase forever for every future reader to reason about. Migrations
that converge an existing *local* database are still expected (developer
checkouts are real); compatibility with anything *outside* the repo is not.

Revisit this section when the first real deployment happens — from that point
the calculus changes.

## Architecture invariants (never violate these)

1. **Everything derives from Table metadata.** Models are JSON definitions
   stored in the `table_def` table. Tables, APIs, forms, list views,
   validation schemas, and RLS policies are all *generated* from that JSON.
   Never hand-write a per-model table, endpoint, or form component.
2. **All reads and writes go through the server** (`apps/server`); clients
   never talk to Postgres directly. Every mutation calls the server's
   row-save/submit/cancel/delete operations, which run the full automation-
   trigger chain (on check → before saving → DB write → after saving) in one
   transaction, including sub-tables and id patterns.
3. **The Admin UI is generic.** One `ListView` and one `FormView` render
   every Table from its metadata. Adding a Table requires zero frontend
   code.
4. **Frappe wire-format compatibility is NOT a goal.** This project began as
   a faithful Frappe replication (an intentional exercise, completed) and
   has since moved into a deliberate second phase of diverging from Frappe's
   design — including vocabulary and API shape — where it doesn't serve this
   platform's own users. Do not reintroduce Frappe-specific wire shapes
   (`exc_type`, `frappe.client.*`, `/api/method/<dotted.path>` RPC naming,
   etc.) for compatibility's sake — they were removed on purpose.

> `docs/ROADMAP.md` still describes a React + Supabase stack. That is the
> original plan, not the implementation. Features it frames in terms of
> Supabase / PostgREST / Supabase Auth / Supabase Realtime are satisfied here
> with local equivalents: native Postgres RLS, server-issued JWTs, server
> websockets, and disk-backed file storage. See
> [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md).

## Stack

- `apps/server` — Node + Hono + TypeScript, the [`postgres`](https://github.com/porsager/postgres)
  client (not an ORM), Zod for validation, `ws` for realtime, Playwright for
  server-side PDF printing
- `apps/web` — React 19 + Vite + TypeScript, TanStack Router + TanStack Query,
  Tailwind v4. There is **no** shadcn/ui and **no** react-hook-form — UI is
  built from the shared `.fc-*` component classes described in `PROGRESS.md`
- `packages/shared` — types and contracts used by both sides
- [`feather-testing-postgres`](https://github.com/siraj-samsudeen/feather-testing-postgres)
  — the SQL Sandbox test harness, consumed as a published npm dependency. It
  lives in its own repo; fix it there and release, never vendor it back in.
  *Temporarily pinned to a git commit* while the `renderApp` rename sits
  unreleased on its `main`; move both `package.json`s back to `^0.2.0` once
  it publishes (see the 2026-07-31 `PROGRESS.md` entry)
- Monorepo — pnpm workspaces; boot everything with `./init.sh`

**Visual identity is a standing directive.** Every new UI feature must inherit
the Frappe-inspired Admin look — design tokens and the `.fc-card` / `.fc-input` /
`.fc-btn` component classes. The rules are at the top of `PROGRESS.md`; read
them before writing any UI.

## Environment

- **Database:** whatever `DATABASE_URL` points at — by default the local
  Postgres on **port 5432**, database **`featherbase`**. There is no `.pgdata`
  directory and nothing runs on 5433.
- **`./init.sh` never manages a Postgres that already answers.** It probes
  `DATABASE_URL` first; only if that fails does it try to start a cluster
  (Debian `pg_ctlcluster`, macOS `brew services`) and then create the role and
  database over whichever superuser connection the host accepts — the current
  login user on Homebrew, `su postgres` when running as root in the container.
  So it works on macOS and Linux alike, and is a no-op once things are up.
- **Connection strings** default in `apps/server/src/config.ts`; override with
  `DATABASE_URL`. The RLS suite connects as the `app_client` role and
  overrides with `RLS_TEST_URL`.
- **Servers:** API on `:8000`, web on `:5173`. `./init.sh` kills stale
  listeners by port and waits for both to answer.
- **Chromium is resolved from the environment, never hardcoded.** Both
  `apps/web/playwright.config.ts` and `apps/server/src/print.ts` let Playwright
  resolve its own installed browser unless `CHROMIUM_PATH` names one; `print.ts`
  additionally scans `PLAYWRIGHT_BROWSERS_PATH` (defaulting to the container's
  `/opt/pw-browsers`) when that directory exists. Set `CHROMIUM_PATH` if you
  need a specific binary — do not reintroduce a literal path.

## Testing

Every test runs inside a real Postgres transaction that is rolled back at the
end — Phoenix's Ecto SQL Sandbox model, via `feather-testing-postgres`. No
mocks, no fixture files, no cleanup code.

Both suites set `fileParallelism: false` on purpose: all test files share one
database and one `background_job` queue, so parallel files steal each
other's jobs and contend on id-pattern row locks. Do not turn it back on.

`background_job` is the one piece of state that outlives a run — a run
killed partway through leaves `queued` rows behind, and the next run then sees
a higher `drainJobs()` count than the test expected. A Vitest `globalSetup`
(`apps/server/test/global-setup.ts`, shared by both suites) empties the queue
once per run, outside any sandbox transaction. It complements
`fileParallelism: false` rather than replacing it.

- `pnpm test` — every suite
- `pnpm smoke` — server + web smoke tests
- `pnpm --filter server typecheck`

## Session protocol

1. **Orient.** Read `PROGRESS.md` (newest entry first), `git log --oneline -20`,
   and `harness/features.json`. Do not re-derive decisions already recorded in
   `docs/adr/`.
2. **Boot & smoke-test.** Run `./init.sh` and verify the app actually starts and
   the core flow passes (login → open a Table list → open a form) BEFORE
   writing new code. If the app is broken, fixing it IS the session's task.
3. **Pick ONE piece of work.** All 126 harness features currently report
   `passing`, so the harness is no longer the backlog — take direction from
   `docs/ROADMAP.md` and the "next" note at the end of the latest `PROGRESS.md`
   entry. Do not start a second thread of work in the same session.
4. **Implement it fully.** Small, complete, working — not broad and half-done.
5. **Verify end-to-end.** Exercise it the way a user would: HTTP calls against
   the running server, and the browser via Playwright for UI. Unit tests alone
   do not count.
6. **Update state.** Only after verification: append a dated entry to
   `PROGRESS.md` (what was done, how it was verified, what to pick up next, any
   gotchas), and commit. Leave the working tree clean.

## Hard rules

- **Never edit, remove, reword, or reorder entries in `harness/features.json`.**
  The only permitted change is flipping a `status` field. If a feature seems
  wrong or infeasible, note it in `PROGRESS.md` and move on.
- Never mark a feature `"passing"` without having exercised it end-to-end in
  this session.
- Never leave the app in a non-booting state at the end of a session. If you run
  out of time mid-change, revert or stash to the last working state and record
  where you stopped in `PROGRESS.md`.
- Commit at every stable point, not just at session end.
- Keep `./init.sh` working at all times; if setup steps change, update it in the
  same commit.

## Where decisions live

- `docs/adr/` — architecture decisions. [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md)
  records the move to React + Hono + Postgres and supersedes 0001–0004.
- `docs/VISION.md` — what this is for and who it serves.
- `docs/research/` — Frappe architecture, Glide, and stack studies.
- `docs/archive/convex-capabilities/` — specs from the retired Convex
  implementation, preserved on the `archive/convex-v1` tag.
