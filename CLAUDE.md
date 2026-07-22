# Featherbase — Agent Instructions

You are building a metadata-driven low-code app platform replicating
[Frappe Framework](https://frappe.io/framework) on a JS/TS stack.
Read `docs/ROADMAP.md` for the strategy and `docs/adr/` for the decisions
already made. This file is your standing protocol — follow it every session.

The project was developed under the working name `frappe-clone` and became
Featherbase in July 2026. You will still see that name in a few places; see
**Naming leftovers** at the bottom.

## Architecture invariants (never violate these)

1. **Everything derives from DocType metadata.** Models are JSON definitions
   stored in the `doctype` table. Tables, APIs, forms, list views, validation
   schemas, and RLS policies are all *generated* from that JSON. Never
   hand-write a per-model table, endpoint, or form component.
2. **All reads and writes go through the server** (`apps/server`); clients
   never talk to Postgres directly. Every mutation calls the server's
   `save_doc` / `submit_doc` / `delete_doc` endpoints, which run the full
   lifecycle hook chain (`validate` → `before_save` → DB write →
   `after_save`) in one transaction, including child tables and naming
   series.
3. **The Desk UI is generic.** One `ListView` and one `FormView` render every
   DocType from its metadata. Adding a DocType requires zero frontend code.
4. **Frappe wire-format compatibility is deliberate.** Sessions ride an
   HttpOnly `sid` cookie alongside a Bearer token, `POST /api/method/login`
   returns Frappe's shape, error bodies carry `exc_type`, and the
   `frappe.client.*` RPC namespace is implemented. Do not "clean up" these
   shapes — existing Frappe clients depend on them.

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
  lives in its own repo; fix it there and release, never vendor it back in
- Monorepo — pnpm workspaces; boot everything with `./init.sh`

**Visual identity is a standing directive.** Every new UI feature must inherit
the Frappe-like Desk look — design tokens and the `.fc-card` / `.fc-input` /
`.fc-btn` component classes. The rules are at the top of `PROGRESS.md`; read
them before writing any UI.

## Environment

- **Database:** the system Postgres 16 cluster on **port 5432**, database
  **`frappe_clone`**. `./init.sh` starts the cluster, sets the `postgres`
  password, and creates the database if missing. There is no `.pgdata`
  directory and nothing runs on 5433.
- **Connection strings** default in `apps/server/src/config.ts`; override with
  `DATABASE_URL`. The RLS suite connects as the `desk_client` role and
  overrides with `RLS_TEST_URL`.
- **Servers:** API on `:8000`, web on `:5173`. `./init.sh` kills stale
  listeners by port and waits for both to answer.

## Testing

Every test runs inside a real Postgres transaction that is rolled back at the
end — Phoenix's Ecto SQL Sandbox model, via `feather-testing-postgres`. No
mocks, no fixture files, no cleanup code.

Both suites set `fileParallelism: false` on purpose: all test files share one
database and one `tab_background_job` queue, so parallel files steal each
other's jobs and contend on naming-series row locks. Do not turn it back on.

`tab_background_job` is the one piece of state that outlives a run — a run
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
   the core flow passes (login → open a DocType list → open a form) BEFORE
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

## Known rough edges

- **Playwright browser path is hardcoded.** `apps/web/playwright.config.ts` sets
  `executablePath: '/opt/pw-browsers/chromium'`, which exists in the container
  but not on a typical macOS checkout, so browser tests fail locally until it is
  overridden. `apps/server/src/print.ts` handles this better — it honours
  `PLAYWRIGHT_BROWSERS_PATH` and falls back to a default launch.
- **Naming leftovers.** The Postgres database is still called `frappe_clone`,
  in `init.sh`, `apps/server/src/config.ts`, and `apps/server/test/rls.test.ts`.
  Renaming it means changing those together plus
  `ALTER DATABASE frappe_clone RENAME TO featherbase;` — it is deliberately not
  done yet. Note that `docs/research/frappe-architecture.md` mentions
  `frappe_clone` as a *filesystem path* to an upstream Frappe checkout; that one
  is unrelated and must not be changed.

## Where decisions live

- `docs/adr/` — architecture decisions. [ADR 0006](docs/adr/0006-stack-react-hono-postgres.md)
  records the move to React + Hono + Postgres and supersedes 0001–0004.
- `docs/VISION.md` — what this is for and who it serves.
- `docs/research/` — Frappe architecture, Glide, and stack studies.
- `docs/archive/convex-capabilities/` — specs from the retired Convex
  implementation, preserved on the `archive/convex-v1` tag.
