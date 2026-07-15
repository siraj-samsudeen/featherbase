# Progress Log

## 2026-07-15 — UI-007 + UI-008 + UI-016 passing: grid ops, sections, breadcrumbs

- ChildGrid gained ↑/↓ reorder buttons (swap-based move). Playwright drives
  the full loop: edit cell, delete row, add row, move it up, save — then
  asserts the DB via API returns exact [item, qty, idx] order.
- Section testids + first:border styling; 'UI Section DT' fixture with
  Section Break + Column Break renders two grouped sections in metadata
  order (fields provably in the right section, b1 absent from section 0).
- Breadcrumbs (Desk / DocType / name) on FormView; doctype crumb navigates
  back to the list; title bar Saved/Not saved cycle re-verified.
- 12 web e2e + 107 server tests green. 42/126 — one-third done.
- Next: DOC-008 (amend) + DOC-009 (versions) close the document engine;
  then PERM-006 (permlevel), PERM-008 (DocShare), UI-011 (DocType builder
  UI), META-004 (schema sync — needed by UI-011 editing).

---

## 2026-07-15 — PERM-010 + UI-006 passing: filtered link search, autocomplete

- PERM-010: dedicated suite proves the autocomplete query shape (list API,
  name-like filter) is permission-filtered: no-read 403, if_owner returns
  only own docs, user permissions narrow further, bypass unaffected.
- UI-006: `LinkControl` in FormView — debounced (150ms) search over
  listResource, dropdown with matches, mousedown-select stores the name,
  'No matches' state, '+ Create new <target>' footer navigating to
  /desk/$target/new. Playwright: filter narrows 2→1, pick persists through
  save+reload, create-new lands on a blank form.
- 9 web e2e + 107 server tests green. 39/126.
- Next: UI-007 (child grid verification), UI-008 (section layout — code
  exists, needs breaks fixture + Playwright), UI-016 (title bar — mostly
  built), PERM-006 (permlevel), DOC-008/009.

---

## 2026-07-15 — PERM-005 passing: user permissions

- Migration 0007 installs 'User Permission' DocType (user, allow→DocType,
  for_value). permissions.ts: `getUserPermissionMap` + `checkUserPermissions`
  + `isBypassUser`. getList injects name-in / linkfield-in filters for
  non-bypass users; document paths (read/insert/update/delete/docstatus)
  assert against the map — insert checks OUTGOING link values too.
- Verified: 104 vitest (list narrowing on link + target doctype, 403 direct
  reads, create-with-forbidden-link 403, admin unaffected) + live e2e
  (restricted user lists only CoA, CoB read 403).
- 37/126. Next: PERM-010 (its verify is now implementable: restricted link
  search), then UI-006 (link autocomplete), PERM-006 (permlevel), PERM-008
  (DocShare).

---

## 2026-07-15 — UI-009 + META-013 passing: shared zod schema on the client

- Web app now depends on the `shared` workspace package; FormView.save()
  runs `metaToZod(meta.fields).safeParse(values)` BEFORE the network — the
  literal same generator the server validates with. Field errors render
  inline; the save request is never sent (verified with a Playwright route
  counter: 0 calls on invalid, 1 on valid).
- Note: UI-009 and META-013 were mutually-dependent halves (client usage
  was META-013's missing clause; UI-009's dep was META-013) — implemented
  and flipped together as one unit; recorded here per protocol.
- 8 web e2e + 99 server tests green. 36/126.
- Next: PERM-005 (user permissions) → unlocks PERM-010 → unlocks UI-006
  (link autocomplete). Then UI-007/UI-008/UI-016.

---

## 2026-07-15 — Evaluation pass #3 + UI-004/UI-005/META-012 passing: generic FormView

- **Evaluator pass #3** (UI probes): core DocTypes render in ListView,
  malformed filters URL doesn't crash, sort+filter compose. Finding fixed:
  TanStack Query retried 4xx errors leaving missing/forbidden doctypes
  stuck on "Loading…" — query client now fails fast on ApiError < 500.
- **FormView** (components/FormView.tsx): one component renders + saves any
  DocType. Controls per fieldtype (number/date/datetime-local/checkbox/
  select/textarea/JSON mono/link combobox/child grid), Section/Column Break
  layout grouping, reqd asterisks, read_only disabled, dirty tracking
  (Save disabled when clean), field-wise server errors inline, create mode
  at /desk/$doctype/new. ChildGrid: editable cells, add/remove rows (full
  verification of grid ops is UI-007).
- **API fix found by tests**: REST POST stripped doc.name, making
  prompt-named DocTypes impossible to create via REST. POST now keeps the
  name but is create-only (saveDoc mode='insert' → 409 on existing).
- **Round-trip fix**: DB date columns serialize as full ISO timestamps and
  failed Date re-validation on save; shared schema now normalizes.
- META-012 flipped: FormView renders /desk/DocType/User with meta fields
  and the DocField child grid (verified via Playwright probe).
- 7 web e2e + 99 server tests green. 34/126.
- Next: UI-006 (link autocomplete), UI-009 (client zod → flips META-013),
  UI-007 (child grid verification), UI-016 (title bar indicator — mostly
  done inside FormView already).

---

## 2026-07-15 — UI-003 passing: list filters with URL persistence

- FilterBar in ListView: field select (name + non-hidden data fields),
  operators = != like > < >= <= (like auto-wraps %…%), Enter-to-add,
  removable chips. Filters live in the route's `filters` search param
  (JSON) via validateSearch on /desk/$doctype — reload/share-safe;
  paging resets on filter change. Sidebar Links needed explicit
  `search={{ filters: undefined }}` after adding validateSearch (TanStack
  Router makes search params required on Links).
- Playwright: stacked three filters (qty>=25 → 5; +title like; +title = →
  1), URL contains filters=, reload restores chips + narrowed results,
  chip removal widens. All 5 web e2e + server suite green.
- 31/126. Next: UI-004 (generic FormView — all field types) + UI-005
  (save with field-wise errors); those also complete META-012 and
  META-013's client half.

---

## 2026-07-15 — UI-002 passing: generic ListView

- `components/ListView.tsx` + `lib/meta.ts`: ONE component renders any
  DocType — columns from `listColumns()` (name + in_list_view fields,
  fallback first two data fields), click-to-sort headers (toggles asc/desc,
  resets paging), pagination (20/page, prev/next, page-info), keepPreviousData
  for smooth paging, Check renders ✓/✗, name column links to
  /desk/$doctype/$name (placeholder until UI-004).
- Playwright verified on TWO DocTypes with zero doctype-specific code
  ('UI List A' 30 docs: columns/pagination/sort asc+desc; 'UI List B':
  different columns, Check rendering, row-link navigation). Fixtures are
  idempotent via API (create-if-missing) since no DocType-delete path
  exists yet — 'UI List A/B' persist in the dev DB deliberately.
- All 4 web e2e + 99 server tests green.
- 30/126. Next: UI-003 (filter UI) then UI-004/005 (FormView + save).

---

## 2026-07-15 — PERM-007 + UI-001 passing: if_owner scoping, Desk shell live

- PERM-007: `permissionScope()` returns all/owner/none; unconditional rows
  override if_owner rows. Doc-scoped checks (`assertDocPermission`) run
  after the FOR UPDATE/select so ownership is authoritative: update, delete,
  submit/cancel, getDoc; getList injects an owner=user filter for
  owner-scope. Verified with two restricted users (vitest + live curl).
- UI-001: Desk shell wired to the real API — `src/lib/api.ts` (token in
  localStorage, 401 auto-logout redirect, listResource helper), functional
  login page (error display), DeskLayout sidebar listing non-child DocTypes
  via TanStack Query, session user footer, logout, route guards, and a
  /desk/$doctype placeholder for UI-002. Playwright e2e covers: wrong
  password error → login → sidebar shows User/Role/DocType → navigate →
  reload persistence → logout → guard redirect. @types/node added to web.
- 29/126. Next: UI-002 (generic ListView — columns from in_list_view,
  sort, paginate), then UI-003 (filters), UI-004 (FormView). The UI block
  is now unblocked end-to-end.

---

## 2026-07-15 — Evaluation pass #2 + PERM-001/002/003/009 passing

- **Evaluator pass #2**: tampered tokens 401, unauth doctype-create 401,
  disabled-user tokens die immediately (resolveToken re-reads the user row),
  submitted docs immutable via REST PUT, migrate idempotent. Known-risk
  note: meta cache serves stale meta after OUT-OF-BAND (psql) doctype
  deletes — no product delete-DocType path exists yet; when META-004/
  UI-011 add one, it MUST call invalidateMeta.
- **Permission engine** (permissions.ts): getRoles (implicit 'All'; Guest
  special), hasPermission via tab_docperm (role in user-roles, permlevel 0,
  can_<action>), Administrator + System Manager bypass, assertSystemManager
  for /api/doctype. Enforcement at engine level: create/write in saveDoc,
  read in getDoc/getList/meta, delete/submit/cancel in their fns. Engine
  callers default to 'Administrator' (seeds/hooks unaffected).
- Verified: 97 vitest incl. restricted-user matrix + live e2e (read 403 →
  DocPerm grant → read 200, create still 403).
- Gotcha: deleting Users via SQL leaves tab_has_role orphans (no FK) —
  test cleanups must delete child rows explicitly.
- 27/126. Next: PERM-007 (if_owner) or PERM-005 (user permissions), then
  UI-001 (login+shell) — auth + read APIs are ready for the Desk.

---

## 2026-07-15 — API-004 passing: authentication

- `auth.ts`: scrypt password hashing (32-byte key — 64-byte overflowed the
  varchar(140) password_hash column), login by name OR email (enabled users
  with a hash only), HS256 JWT (8h, secret env JWT_SECRET). Auth middleware
  guards ALL /api/* except /api/ping and /api/login; `GET /api/whoami`.
  AuthenticationError type → 401 (PermissionError stays 403 for authz).
  User identity threads into saveDoc/submit/cancel/delete (owner/modified_by
  = actual session user — verified with a non-admin user via live HTTP).
  Migration 0006 sets Administrator password (env ADMIN_PASSWORD, default
  'admin').
- **GOTCHA: this hono version's `verify()` requires the alg argument** —
  `verify(token, secret, 'HS256')`; without it every token 403s.
- Tests all authenticate via `test/helpers.ts` `areq()` (cached admin token);
  any new test file must use areq, not app.request (except auth negative
  tests). Web login page still a shell — UI-001 will wire it to /api/login.
- 23/126. Next: PERM-001..003 (roles/DocPerm/enforcement — DocPerm doctype
  already seeded), then UI-001 (login + shell) since auth is ready.

---

## 2026-07-15 — META-011 + META-014 passing; META-012 half done

- META-011: meta cache in meta.ts (loads/hits stats exported for tests);
  invalidateMeta() called by createDocType. NOTE: dev server caches meta —
  e2e probes that delete DocTypes via psql leave stale entries until a
  create invalidates or the server restarts.
- Bootstrap refactor: doctype/docfield → tab_doctype/tab_docfield (migration
  0004) with standard columns; DocType + DocField described by meta rows, so
  /api/resource/DocType works generically (verified live: list + doc with 8
  child fields). Generic writes/deletes to DocType/DocField are 417 —
  DDL path is /api/doctype. **META-012 stays failing**: its verify also
  needs the Desk form view to render DocType (UI-004).
- META-014: migrate.ts now supports .ts migrations (export up());
  0005_core_seeds.ts installs Role, Has Role, User, DocPerm, Comment,
  Version, File through the engine + seeds System Manager/All/Guest roles,
  Administrator (with System Manager) and Guest users. Verified per
  criterion: scratch DB + migrate → all core DocTypes + Administrator; then
  dropped. NOTE: psql -c can't run drop+create database in one call.
- 22/126. Next: API-004 (auth/login vs User table), PERM-001/002/003 block,
  or META-004 (schema sync). Auth unlocks the UI work.

---

## 2026-07-15 — DOC-007 + API-001 + API-002 passing: submit lifecycle, REST resource

- DOC-007: `submitDoc`/`cancelDoc` via shared `setDocstatus` (FOR UPDATE,
  from-state check, on_submit/on_cancel inside tx). Updates and deletes of
  submitted docs 417; cancelled docs terminal for edits. Endpoints
  /api/submit_doc, /api/cancel_doc.
- API-001/002: /api/resource/:doctype[/name] — GET list (same query-param
  parser as /api/list: filters/fields/order_by/limit_*), POST insert (name
  stripped), GET one, PUT update (name from path), DELETE. All driven by
  the same engine; unknown doctype 404s everywhere; field-wise errors
  surface through.
- Verified: 76 vitest + live e2e (submit→immutable→cancel; REST create+list).
- 20/126. Next: META-011 (meta cache + invalidation), META-012 (bootstrap
  DocType-of-DocTypes), META-014 (core seeds) — then auth (API-004) and
  permissions block, then the Desk UI.

---

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
