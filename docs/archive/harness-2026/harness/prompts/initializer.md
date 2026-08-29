# Initializer Agent — run once, before any coding session

You are setting up the environment for a long-running autonomous build of a
Frappe Framework clone. Do NOT implement product features. Your only job is
to leave a fully bootable skeleton so every future coding session can start
working within minutes.

Read first: `CLAUDE.md`, `docs/ROADMAP.md`, `harness/features.json`.

## Deliverables

1. **Monorepo scaffold** — pnpm workspaces:
   - `apps/server`: Hono + TypeScript + `postgres` client. One health route
     (`GET /api/ping`), config loading, error envelope middleware. Vitest set up
     with one passing test.
   - `apps/web`: Vite + React + TypeScript + Tailwind + shadcn/ui + TanStack
     Router/Query. A login page shell and an authenticated layout shell.
     Playwright configured with `executablePath: '/opt/pw-browsers/chromium'`
     and one passing smoke spec.
   - `packages/shared`: types + the (future) metadata-to-zod generator module.
2. **Database** — Supabase local via `supabase init`/`config.toml`; if the
   Supabase CLI is unavailable in this environment, fall back to a plain
   Postgres started by `init.sh` (document which path you took in
   PROGRESS.md). One SQL migration creating nothing yet but proving the
   migration pipeline runs.
3. **`init.sh` (repo root)** — idempotent: install deps if missing, start
   the database, run migrations, start server + web in the background,
   wait for health checks, then run the smoke test. Exit non-zero loudly if
   any step fails. This script is the contract every session relies on.
4. **Smoke test** — `pnpm smoke`: boots nothing itself, but asserts the
   running stack works (ping endpoint, web app serves, login page renders
   via Playwright).
5. **Update `PROGRESS.md`** with what exists, exact commands, and any
   environment quirks discovered.
6. **Commit** in small logical steps; leave the tree clean and `./init.sh`
   green.

## Rules

- Do not touch `harness/features.json`.
- Do not implement any feature from the list — not even META-001. Skeleton only.
- Prefer boring, standard configurations over clever ones; future sessions
  must be able to guess how things work.
