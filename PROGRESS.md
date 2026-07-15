# Progress Log

## 2026-07-15 — DOC-003/004/006 passing: hooks, controllers, safe deletes

- `controllers.ts`: registry + file loader (src/controllers/*.ts default-
  export {doctype, hooks}); chain runs INSIDE the save tx — insert:
  before_insert→validate→before_save→INSERT→after_insert→after_save;
  update: validate→before_save→UPDATE→after_save. Hooks mutate ctx.doc
  (re-filtered via columnValues so hooks can't inject unknown SQL keys);
  ctx has old/isNew/user/tx. Reference controller hook_file_demo.ts.
- `deleteDoc()` + DELETE /api/doc/:dt/:name: blocks when any Link field
  (parent or child row — child resolves to its parent doc in the message)
  references the doc; runs on_trash; removes own child rows; blocks direct
  child/single deletes. Gotcha found: don't select parent/parenttype from
  non-child tables (column doesn't exist → was 500).
- Verified: 71 vitest + live e2e (slug hook fired on running server;
  linked delete 417 naming holder, then clean delete).
- 17/126. Next: DOC-007 (submit/cancel), then API-001/002 (REST resource)
  or META-004 (schema sync) to unlock CUST-001 later. META-011/012/014
  (cache, bootstrap meta, seeds) also unblocked.

---

## 2026-07-15 — META-008 passing: Link integrity

- `validateLinks()` runs inside the save transaction for parents (insert +
  update) and each child row (prefixed error keys like allocs.1.customer).
  Empty links allowed; missing target DocType and missing target doc both
  produce field-wise 417s.
- Verified: 62 vitest + live e2e (bogus link 417, valid link 201).
- 13/126 passing. Next: DOC-003 (lifecycle hooks) + DOC-004 (controller
  registry) — they unlock DOC-006/007 and the whole business-logic layer.

---

## 2026-07-15 — META-007 + DOC-005 passing: child tables

- `pickChildInputs`/`saveChildren`/`loadChildren` in document.ts: Table
  fields carry arrays; rows validated against child meta (errors keyed
  `field.i.child_field`), existing names updated, new rows inserted with
  parent/parenttype/parentfield + idx by array order, omitted rows deleted
  (payload authoritative) — all inside the parent's transaction (child
  error rolls parent back; verified). Direct save of istable DocTypes is
  blocked. createDocType validates Table options target is istable.
  getDoc/save responses include children ordered by idx.
- Verified: 59 vitest + live e2e (order with 2 rows; psql shows linkage).
- Next: META-008 (Link integrity), then DOC-003/004 (hooks + controllers)
  to unlock DOC-006/007.

---

## 2026-07-15 — Evaluation pass #1 + META-010 passing

- **Evaluator pass** (3rd wakeup): re-drove META-006/009/003, DOC-002/011 on
  fresh DocTypes via public HTTP. Held up: injection-safe prompt names,
  stale-update 409s, SQL-keyword DocType names, empty-reqd/overlong-data
  417s. **Finding: Int of 1e20 leaked a 500** (passed zod int check, blew
  bigint range). No status flips warranted; defect fixed this session.
- **META-010**: `applyDefaults()` (typed defaults incl. read_only fields),
  read_only client values silently dropped in `pickFieldValues` (insert AND
  update), `mapDbError()` translates PG 23505 unique violations to
  field-wise 417s (constraint name → fieldname) and 22003/22001/22P02 range
  errors to 417. Int schema now bounded to JS safe-integer range (fixes the
  evaluator finding).
- Verified: 53 vitest + live e2e (huge int 417, duplicate unique 417 with
  fields.c).
- Next: META-007 (child tables) + DOC-005 (transactional child saves), then
  META-008 (link integrity).

---

## 2026-07-15 — DOC-011 + META-009 passing: metadata-driven validation

- `packages/shared/src/schema.ts`: `metaToZod(fields)` builds a zod object
  per DocType (type-correct per fieldtype, Select→enum from options, reqd
  enforcement, empty→undefined preprocess); `zodFieldErrors()` flattens to
  {fieldname: message}. Server dep: `shared` workspace package.
- document.ts `validateValues()`: full-object validation on insert,
  `.partial()` on update (only changed fields), provided-but-empty values
  become explicit SQL nulls so updates can clear fields.
- DOC-011 + META-009 verified (48 vitest; live e2e returned both title
  'Required' and qty NaN errors in one field-wise envelope).
- META-013 stays failing: the CLIENT must consume the same schema (lands
  with UI-009). META-010 (defaults, read_only, unique mapping) still open —
  reqd alone doesn't satisfy it.
- Next: META-010, then META-007/DOC-005 (child tables) or META-008 (link
  integrity).

---

## 2026-07-15 — META-006 passing: naming engine

- `resolveName()` in document.ts inside the save transaction: hash (default),
  prompt (client name required; if the name already exists it becomes an
  update), field:<fieldname>, and series `PREFIX-.####` via `series` table
  with INSERT..ON CONFLICT DO UPDATE RETURNING (row-lock serializes
  concurrent savers). Migration 0003 adds `series`.
- saveDoc name-routing changed: name present → update if exists, else 404
  unless autoname=prompt (insert-with-name).
- Verified: 44 vitest incl. 50 parallel inserts → exactly NMINV-0001..0050,
  no gaps/dupes; live e2e produced E2EINV-0001..0003.
- Next: META-013 + DOC-011 (zod validation, field-wise errors), then
  META-009/010.

---

## 2026-07-15 — DOC-010 passing: get_list query engine

- `query.ts`: `getList()` with [field, op, value] filters (=, !=, <, >, <=,
  >=, like/not like as ilike, in/not in), field projection, order_by parsing
  (regex-validated, identifier-quoted — injection attempts 417), pagination
  (max 500) + total count. Every field name validated against meta columns.
  `GET /api/list/:doctype` with JSON query params.
- Verified: 40 vitest incl. injection attempt + live e2e (like filter,
  unknown field 417).
- Next: META-013 (shared zod schemas) + DOC-011 (field-wise validation) go
  together; then META-006 naming series, META-009/010 flag enforcement.

---

## 2026-07-15 — DOC-002 + META-005 passing: updates with optimistic concurrency

- `saveDoc` now routes docs carrying a `name` to `updateDoc`: SELECT ... FOR
  UPDATE, compares client-echoed `modified` timestamp against DB (409
  ConflictError on mismatch, 417 if omitted), auto-bumps
  modified/modified_by, preserves owner/creation. Standard-field payload
  keys are ignored rather than rejected so clients can send whole docs back.
- META-005 flipped too: columns verified via information_schema (ddl.test),
  auto-set on insert (document.test) and update (update.test).
- Verified: 36 vitest + live e2e (fresh update 201 → v2 in psql; replay of
  same modified → 409; row unchanged).
- Next: META-006 (naming series with atomic counter) or DOC-010 (get_list) —
  both unlock a lot. Prefer DOC-010 next; then META-013/DOC-011 validation.

---

## 2026-07-15 — DOC-001 passing: save_doc insert path

- `document.ts`: `saveDoc()` loads meta, rejects unknown fields (field-wise
  errors), skips layout/Table fields, generates hash names, auto-sets
  standard fields (owner/creation/modified/modified_by/docstatus/idx),
  transactional insert, returns full doc. `getDoc()` reads back.
  Endpoints: `POST /api/save_doc` {doctype, doc}, `GET /api/doc/:dt/:name`.
- Verified: vitest (insert+readback, unknown-field 417, 404s, envelope) +
  live e2e (create DocType → save_doc → row visible via psql).
- Gotcha: postgres lib returns bigint columns as strings ('3' not 3) —
  typed value coercion should land with META-013 zod schemas.
- Gotcha: doctype tests that create DocTypes must also drop tab_* tables in
  cleanup now that DDL runs (fixed doctype-engine.test.ts).
- Note: DOC-001's dep META-005 is implemented (columns + auto-set on
  insert) but stays failing until update-path auto-set exists (DOC-002).
- Next: DOC-002 (update + conflict detection) → then META-005 flip.

---

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
