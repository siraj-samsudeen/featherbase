# Frappe Clone — Agent Instructions

You are building a metadata-driven low-code framework replicating
[Frappe Framework](https://frappe.io/framework) on a JS stack.
Read `docs/ROADMAP.md` for the architecture. This file is your standing
protocol — follow it in every session.

## Architecture invariants (never violate these)

1. **Everything derives from DocType metadata.** Models are JSON definitions
   stored in the `doctype` table. Tables, APIs, forms, list views, validation
   schemas, and RLS policies are all *generated* from that JSON. Never
   hand-write a per-model table, endpoint, or form component.
2. **All writes go through the Document engine** (`apps/server`). Clients get
   read-only access to Postgres via PostgREST/supabase-js; `INSERT`/`UPDATE`/
   `DELETE` are denied by RLS. Every mutation calls the server's `save_doc` /
   `submit_doc` / `delete_doc` endpoints, which run the full lifecycle hook
   chain (`validate` → `before_save` → DB write → `after_save`) in one
   transaction, including child tables and naming series.
3. **The Desk UI is generic.** One `ListView` and one `FormView` render every
   DocType from its metadata. Adding a DocType requires zero frontend code.

## Stack

- `apps/web` — React + Vite + TypeScript, TanStack Router + Query,
  Tailwind + shadcn/ui, react-hook-form + zod
- `apps/server` — Node + Hono + TypeScript, `postgres` client, Zod
- Database — Supabase local (Postgres); realtime, auth, storage via Supabase
- Monorepo — pnpm workspaces; run everything with `./init.sh`

## Session protocol (do this every session, in order)

1. **Orient.** Read `PROGRESS.md`, `git log --oneline -20`, and
   `harness/features.json`. Do not re-derive decisions already recorded.
2. **Boot & smoke-test.** Run `./init.sh`. Verify the app actually starts and
   the core smoke flow passes (login → open a DocType list → open a form)
   BEFORE writing any new code. If the app is broken, fixing it IS the
   session's task.
3. **Pick ONE feature.** Choose the highest-priority feature in
   `harness/features.json` with `"status": "failing"` whose dependencies are
   met. Do not start a second feature in the same session.
4. **Implement it fully.** Small, complete, working — not broad and half-done.
5. **Verify end-to-end.** Exercise the feature the way a user would (HTTP
   calls against the running server; browser via Playwright for UI features —
   Chromium is at `/opt/pw-browsers/chromium`). Unit tests alone do not count.
6. **Update state.** Only after verification: set the feature's `status` to
   `"passing"`, append a dated entry to `PROGRESS.md` (what was done, how it
   was verified, what to pick up next, any gotchas discovered), and commit
   with a descriptive message. Leave the working tree clean.

## Hard rules

- **Never edit, remove, reword, or reorder entries in
  `harness/features.json`.** The only permitted change is flipping a
  `status` field. If a feature seems wrong or infeasible, note it in
  `PROGRESS.md` and move on.
- Never mark a feature `"passing"` without having exercised it end-to-end in
  this session.
- Never leave the app in a non-booting state at the end of a session. If you
  are out of time mid-feature, revert or stash to the last working state and
  record where you stopped in `PROGRESS.md`.
- Commit at every stable point, not just at session end.
- Keep `init.sh` working at all times; if setup steps change, update it in
  the same commit.
