# Progress Log

## 2026-07-15 — META-003 passing: DDL generation

- `createTableDDL()` in doctype-engine: standard columns always, parent
  linkage + (parent,idx) index for istable, per-field columns via
  `columnType()`, unique constraints, no table for issingle. DDL runs in the
  SAME transaction as metadata rows (verified rollback: pre-existing table
  name → 500 and no orphan doctype row). `tableName()` = tab_<snake_case>.
- Verified: vitest column-type assertions via information_schema + live API
  created 'Task' → `\d tab_task` shows all columns/PK; cleaned up after.
- Next: DOC-001 (save_doc insert through Document engine), which will also
  complete META-005's auto-set behavior.

---

## 2026-07-15 — META-002 passing: field type system

- `doctype-engine.ts`: `columnType()` maps all 16 fieldtypes to PG column
  types (Table/Section Break/Column Break → no column); `createDocType()`
  validates via zod (`doctypeDefSchema`) + semantic checks (reserved
  `STANDARD_COLUMNS`, duplicate fieldnames, Link/Table/Select require
  options), inserts doctype+docfield rows transactionally, 409 on duplicate.
  `POST /api/doctype` endpoint. Field-wise 417 error envelope.
- Verified: 25 vitest cases + live HTTP (invalid fieldtype 417 with
  field-wise message; valid def persists rows).
- NOTE: `POST /api/doctype` stores metadata only — DDL is META-003, next.

---

## 2026-07-15 — META-001 passing: DocType metadata storage

- Migration `0002_doctype.sql`: `doctype` + `docfield` tables (FK cascade,
  `(parent, fieldname)` unique, ordered by `idx`). `src/meta.ts`: `getMeta()`
  loads a `DocTypeMeta` with ordered fields; `GET /api/meta/:doctype` serves
  it. `FIELD_TYPES` const defined (enforcement lands with META-002).
- Verified: vitest (loader, HTTP, 404 envelope) + live e2e — SQL-inserted
  'E2E Task' returned by the running server with fields; unknown doctype
  404s; doctype delete cascades docfields.
- Next: META-002 (fieldtype→pg column mapping + rejection of invalid
  fieldtypes on a DocType-save path), then META-003 (DDL generation).

---

Newest entries first. Every session appends: date, feature ID worked on,
what was done, how it was verified, what to pick up next, gotchas.

---

## 2026-07-15 — Initializer session complete: stack boots green

- Scaffolded pnpm monorepo: `apps/server` (Hono, `postgres` client, error
  envelope, SQL migration runner, `/api/ping`), `apps/web` (Vite + React 19 +
  Tailwind v4 + TanStack Router/Query, login + desk shells, Playwright),
  `packages/shared` (placeholder for META-013 zod generator).
- **Database decision (user-approved): local system Postgres 16 cluster on
  port 5432, NOT Supabase.** `init.sh` starts it via `pg_ctlcluster`, sets
  postgres password to 'postgres', creates `frappe_clone` db.
  `DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/frappe_clone`.
  Supabase-flavored features map to local equivalents (see CLAUDE.md).
- Verified end-to-end: `./init.sh` exits 0 — migrations apply, server :8000
  and web :5173 boot, server smoke (ping+db) and Playwright smoke (login
  page renders, API via proxy) all pass.
- **Gotchas**: (1) Docker daemon is not running in this environment — do not
  try Supabase local or docker compose. (2) Playwright must use
  `executablePath: '/opt/pw-browsers/chromium'` (already in
  playwright.config.ts). (3) Piping `./init.sh | tail` never returns EOF
  because the spawned dev servers hold the pipe; run it as
  `bash init.sh > /tmp/init.log 2>&1` and read the log instead.
  (4) `pkill -f init.sh` will kill your own shell if the command string
  contains "init.sh" — use exact patterns.
- **Next session**: META-001 (doctype/docfield storage + Meta loader).

---

## 2026-07-15 — Harness initialized (no code yet)

- Repo contains strategy (`docs/ROADMAP.md`) and the agent harness
  (`CLAUDE.md`, `harness/`). No application code exists yet.
- **Next session**: run the initializer prompt (`harness/prompts/initializer.md`)
  to scaffold the monorepo, Supabase local config, and `init.sh`, then start
  on `META-001`.
- Gotchas: none yet.
