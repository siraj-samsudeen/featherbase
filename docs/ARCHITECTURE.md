# Architecture

Featherbase is a metadata-driven app platform: you define a model (a
**Table**) as JSON, and the platform generates the database table, the API,
the validation schema, and the UI from that one definition. Nothing is
hand-written per model — one save path, one list view, one form view serve
every Table.

This document walks one request end to end, then explains the metadata
engine and the generic Admin UI, and closes with a map of the source tree.

> This project began as a faithful replication of [Frappe
> Framework](https://frappe.io/framework); the vocabulary below (Table, Row,
> Column, ...) is Featherbase's own, having since diverged from Frappe's
> naming and wire format on purpose. See [GLOSSARY.md](GLOSSARY.md) and
> [ADR 0006](adr/0006-stack-react-hono-postgres.md)'s addendum.

## The life of a row-save request

Everything below is traceable in two files: the routes in
`apps/server/src/index.ts` and the lifecycle in `apps/server/src/document.ts`.
The API surface itself is being redesigned around a unified action registry
(`GET/POST /api/table/:table`, `GET/PATCH/DELETE /api/table/:table/:name`,
row actions such as submit/cancel/apply-workflow-action, collection actions
such as bulk-update, and free-standing methods); the walkthrough below
describes the insert path — a `POST /api/table/:table` call — since that's
where the interesting lifecycle work happens.

### 1. Route and middleware

The server is a single Hono app built in `apps/server/src/index.ts`. Before
any handler runs, three middlewares apply to `/api/*`:

- `secureHeaders()` and a CORS policy restricted to the Admin UI's origins
  (`config.allowedOrigins`, default `http://localhost:5173`).
- The auth middleware (`app.use('/api/*', ...)` — registered after the public
  routes) resolves the caller and stores it as `c.var.user`. Credentials come
  from `authCredential()`: the `Authorization` header wins; an HttpOnly `sid`
  cookie is the fallback. Frappe wire-format compatibility is no longer a
  goal (see the Frappe-divergence section below); the cookie mechanism itself
  stays because it's just a normal session cookie, not a Frappe-specific
  shape.
- `rateLimit` (`apps/server/src/rate-limit.ts`), keyed by the resolved user.

Token resolution lives in `apps/server/src/auth.ts` (`resolveToken`): a
`Bearer <jwt>` is verified against `JWT_SECRET` and looked up in the `user`
table; an `Authorization: token key:secret` pair authenticates an
integration via its API key.

The route itself (illustrative — exact shape tracked in #61):

```ts
// apps/server/src/index.ts
app.post('/api/table/:table', async (c) => {
  const body = await c.req.json()          // { row }
  const saved = await saveDoc(c.req.param('table'), body.row, who(c))
  publishDocEvent(c.req.param('table'), String(saved.name), hadName ? 'updated' : 'created')
  return c.json(saved, 201)
})
```

The handler is deliberately thin: parse, call `saveDoc`, publish a realtime
event (`apps/server/src/realtime.ts`), return the saved row as JSON with
status 201. (`saveDoc` and the other row-lifecycle functions —
`submitDoc`/`cancelDoc`/`deleteDoc`/`getDoc` — keep their current names in
`apps/server/src/document.ts`; the rename replaced the vocabulary these
functions operate on, not every function name built from it.)

### 2. `saveDoc` — before the transaction

`saveDoc` in `apps/server/src/document.ts` starts by loading the Table's
metadata via `getMeta` (`apps/server/src/meta.ts`, a per-process cache over
`table_def` + `column_def`). Then it routes special cases:

- `Table` / `Column` rows are refused — schema changes must go through the
  table-definition endpoint so DDL runs (the `ENGINE_MANAGED` set).
- A Settings Table (`kind: 'settings'`) goes to `saveSingle`, which persists
  values into the `single_value` EAV table instead of a generated table.
- A Sub-table (`kind: 'sub_table'`) is refused as a top-level save — its rows
  are only saved through their parent Row.
- If `row.name` is set and the row exists, this is an **update** and control
  passes to `updateDoc` (see below). Otherwise it is an **insert**.

For an insert, before any SQL write:

- `assertDocPermission(user, table, 'create')` and Data Scope checks
  (`apps/server/src/permissions.ts`).
- `pickFieldValues` filters the payload to declared columns — unknown keys
  are a `ValidationError` (typos fail loudly), `read_only` columns are
  ignored (they are system-managed).
- `stripUnwritableFields` drops columns above the caller's writable tier.
- `applyDefaults` fills declared `default_value`s.
- `validateValues` parses the result against a Zod schema **generated from
  the metadata** (`tableSchemaToZod` in `packages/shared`) — required columns,
  types, choice lists.
- `applySla` (`apps/server/src/sla.ts`) stamps response/resolution deadlines
  if an active SLA covers this Table.
- If a Workflow governs the Table, the workflow state column is forced to
  the initial state — a caller cannot smuggle in a later state
  (`apps/server/src/workflow.ts`).

### 3. Inside the transaction

The write happens in a single `sql.begin(...)` transaction:

1. **Naming** — `resolveName` applies the Table's id pattern: `hash`
   (random), `prompt` (client supplies the name), `field:<column>`, or a
   series like `TASK-.####`. Series counters use
   `INSERT ... ON CONFLICT DO UPDATE` on the `series` table *inside* the
   transaction, so concurrent savers serialize on the counter row and a
   rolled-back save rolls the increment back too.
2. **Pre-write automation triggers** — `runHooks`
   (`apps/server/src/controllers.ts`) runs the on-check and before-saving
   moments (`before_insert → before_validate → validate → before_save`),
   interleaved with sandboxed Server Scripts for the same moments
   (`runDocEventScripts` in `apps/server/src/server-scripts.ts`). Triggers
   may mutate `ctx.row`; any throw aborts the whole transaction.
3. **Reference validation** — `validateLinks` checks every Reference column
   references an existing row of its target Table.
4. **The INSERT** into the generated table.
5. **Sub-tables** — `saveChildren` writes each Sub-table column's rows into
   the child Table's table (with `parent`, `parenttype`, `parentfield`
   linkage), in the same transaction. On update, rows omitted from the
   payload are deleted — the payload is authoritative.
6. **Post-write automation triggers** — the after-saving moments
   (`after_insert → after_save → on_update`), plus `after_save` Server
   Scripts.

The update path (`updateDoc`) differs in a few ways: it takes the row with
`SELECT ... FOR UPDATE`, enforces **optimistic concurrency** (the client must
echo the `updated_at` timestamp it loaded; a mismatch is a 409
`ConflictError`), refuses writes to submitted/cancelled rows (`status`
`submitted`/`cancelled`), blocks direct edits to a workflow-controlled state
column, and records a column-level diff into the `version` table
(`recordVersion`) when the Table has `track_changes`.

### 4. After commit — subsystem fan-out

Only after the transaction commits does the save fan out to side effects
(all in `document.ts`, right after the `sql.begin` block):

- `evaluateEmailRules` (`apps/server/src/email-rules.ts`) — Notification-style
  rules on `on_create` / `on_save`.
- `evaluateAssignmentRules` (`apps/server/src/assignment-rules.ts`) —
  auto-assignment, which creates ToDos.
- `evaluateWebhooks` (`apps/server/src/webhooks.ts`) — outbound HTTP calls.
- Back in the route handler, `publishDocEvent` pushes a realtime event over
  the WebSocket server (`apps/server/src/realtime.ts`).

Submit and cancel (`submitDoc` / `cancelDoc` → `setStatus`) run their own
automation-trigger order — before-submit/before-cancel before the write, then
on-update and on-submit/on-cancel.

### 5. The response

The saved row is re-read with sub-tables attached (`loadChildren`) and passed
through `stripInternalColumns`, which drops anything that is not a standard
column or a declared Column, and always drops credential columns
(`password_hash`, `api_secret_hash`, ...). The client gets plain JSON of the
row.

Errors follow one envelope everywhere (`apps/server/src/errors.ts`): an
`AppError` maps to a status code and a body with
`error: { type, message, columns? }`. This error envelope, like the rest of
the API, is Featherbase's own shape — it no longer carries Frappe's
`exc_type` field or Frappe's status-code conventions; see the Frappe-
divergence section below.

## The automation-trigger chain

`apps/server/src/controllers.ts` keeps a registry of per-Table controllers.
Each file in `apps/server/src/controllers/` default-exports a
`TableController` (`{ table, hooks }`) and is auto-loaded at boot. The
automation-trigger moments, in order:

```
insert: on check (before_insert -> before_validate -> validate)
        -> before saving (before_save) -> INSERT
        -> after saving (after_insert -> after_save) -> on_update
update: on check (before_validate -> validate) -> before saving (before_save)
        -> UPDATE -> after saving (after_save) -> on_update
```

plus before/after submit, before/after cancel, and on-trash. A controller
registered under the wildcard Table `'*'` runs for every Table, after the
specific ones. Automation triggers receive a `HookContext` with the row, the
old row (on update), the metadata, the acting user, and the open transaction
handle.

## The metadata engine

`apps/server/src/doctype-engine.ts` turns a Table's JSON definition into a
real Postgres table (the file itself keeps its pre-rename name; only the
vocabulary and identifiers inside it changed).

A definition is validated by a Zod schema: a name, a `kind`
(`table` / `sub_table` / `settings`), an `is_submittable` flag, an id
pattern, and a list of columns, each with a `column_name` (snake_case), a
`column_type`, type-specific fields (`reference_table`, `choices`,
`row_table`), and flags like `reqd`, `unique`, `in_list_view`, `tier`.

Creating a Table:

1. Inserts one row into `table_def` and one per column into `column_def` —
   the metadata *is* data.
2. Generates `CREATE TABLE "<name>"` from the columns (no `tab_` prefix).
   Every table gets the standard columns (`name` PK, `created_by`,
   `created_at`, `updated_at`, `updated_by`, `status`, `position`);
   sub-tables additionally get `parent`/`parenttype`/`parentfield`. Column
   types map to Postgres column types (`Data` → `varchar(140)`, `Currency` →
   `numeric(21,9)`, `JSON` → `jsonb`, ...). Layout columns (section break,
   column break) and Sub-table columns produce no physical column.
3. Enables row-level security and generates a SELECT-only policy for the
   `app_client` role (`applyRls`) — the local stand-in for a direct
   PostgREST-style client. The app server connects as the table owner and
   remains the only write path (see `apps/server/migrations/0010_rls.sql`).

Updating a Table's definition syncs the edit: new columns add physical
columns (`ALTER TABLE ... ADD COLUMN`), property edits update `column_def`
rows, removed columns delete the column-definition row but **keep** the
physical column unless `drop_columns` is passed, and column-type changes are
rejected outright.

Settings Tables get no table at all — their values live in the
`single_value` EAV table, one row per column.

## The generic Admin UI

The web app never knows about specific Tables. Two facts make that work:

**Metadata comes from the server.** `useMeta` in `apps/web/src/lib/meta.ts`
fetches a Table's metadata and caches it via TanStack Query. Everything the
UI renders — labels, column types, list columns, required flags — derives
from that response. `listColumns` picks the list view's columns: `name`
first, then columns flagged `in_list_view` (or the first two data columns
when none are flagged).

**Routes are generic.** `apps/web/src/router.tsx` defines:

- A Table's list route → `ListView` (`apps/web/src/components/ListView.tsx`),
  with filters kept in the URL. A Settings Table renders its one `FormView`
  directly.
- A Row's route → `FormView` (`apps/web/src/components/FormView.tsx`). The
  literal name `new` means a blank unsaved Row (`const isNew = name ===
  'new'`).
- The new-table route → the Table Builder
  (`apps/web/src/pages/TableBuilder.tsx`), which posts to the
  table-definition endpoint.
- Additional generic views: report/kanban/calendar/gantt, SQL Report, Code
  Report, Home Page, dashboard, permissions, jobs.

`FormView` loads the row, renders an input per column from the metadata, and
saves through the row-save operation traced above, echoing back `updated_at`
for the concurrency check. `AdminLayout`
(`apps/web/src/pages/AdminLayout.tsx`) builds the sidebar from
`GET /api/home_pages` — the caller's visible Home Pages, role-scoped and
permission-filtered server-side — plus an "All tables" page that lists the
`Table` Table itself (rows where `kind != 'sub_table'`), and hosts the
Command Bar (Ctrl/Cmd+K).

Adding a Table therefore requires zero frontend code: define it, and its
list and form views work immediately.

## Diverging from Frappe on purpose

Featherbase began as a deliberate, faithful replication of Frappe
Framework's ideas — that phase is complete. The project is now in a second,
equally deliberate phase: diverging from Frappe's design where it doesn't
serve this platform's own users, starting with vocabulary (this document)
and extending to the wire format. Frappe wire-format compatibility is **not**
a goal going forward. Concretely, this project no longer:

- Shapes login/session responses to match Frappe's `{ message, home_page,
  full_name }` convention.
- Carries `exc_type` in error bodies.
- Dispatches a `frappe.client.*` RPC namespace, or any other dotted
  Frappe method namespace. (The `/api/method/:path` dispatcher itself
  stays — it is this project's own whitelisted-method surface, API-003,
  serving plainly-named methods like `ping` and `count_docs`. What was
  removed is Frappe's *vocabulary* on top of it, not RPC as a feature.)
- Exposes a `/api/resource/:doctype[/:name]` REST shape — the equivalent
  surface is the `/api/table/:table[/:name]` action registry described
  above (tracked in #61).

Do not reintroduce any of the above for compatibility's sake; they were
removed on purpose. See [GLOSSARY.md](GLOSSARY.md) for the full vocabulary
and [ADR 0006](adr/0006-stack-react-hono-postgres.md)'s addendum for the
decision record.

## Project map

### `apps/server/src/`

| Path | Purpose |
|---|---|
| `index.ts` | The Hono app: every route, middleware order, server boot, worker/scheduler startup |
| `config.ts` | Port, `DATABASE_URL` default, allowed CORS origins |
| `db.ts` | The `postgres` client (no ORM) and the test-sandbox delegate hook |
| `meta.ts` | Table metadata loader + per-process cache (`getMeta`, `invalidateMeta`) |
| `doctype-engine.ts` | Table JSON → DDL: create/update tables, standard columns, RLS policies |
| `document.ts` | The row lifecycle: save/update/submit/cancel/amend/delete/rename, naming, sub-tables, versioning |
| `controllers.ts` + `controllers/` | Automation-trigger registry and per-Table controllers (auto-loaded at boot) |
| `query.ts` | Permission-scoped list queries (`getList`, `countDocs`, `groupCount`) |
| `permissions.ts` | Permission checks, tiers, own-rows-only, Data Scopes, shares |
| `auth.ts` | Login, JWT sessions, scrypt password hashing, API keys |
| `oauth.ts` | Google OAuth flow with a dev mock provider |
| `password-reset.ts` | Reset request + token redemption |
| `rate-limit.ts` | Per-user request throttling |
| `errors.ts` | `AppError`, status mapping, the error envelope |
| `methods.ts` + `methods/` | Free-standing RPC-style methods |
| `workflow.ts` | Workflow states/transitions, role-gated actions |
| `server-scripts.ts` | Sandboxed (node:vm) Server Scripts + workflow condition evaluation |
| `custom-fields.ts` | Apply Custom Field records (column + column-definition row) |
| `customizations.ts` | Export/import Custom Fields + Metadata Overrides as JSON |
| `email.ts`, `email-rules.ts` | Email queue/delivery and notification rules |
| `assign.ts`, `assignment-rules.ts` | Assignments (ToDo + notify) and auto-assignment rules |
| `sla.ts` | SLA deadline stamping and escalation support |
| `webhooks.ts` | Outbound webhooks on lifecycle events |
| `jobs.ts` + `jobs/` | Background job queue (`background_job`), worker, handlers |
| `realtime.ts` | WebSocket server, row/user event publishing |
| `search.ts` | Command Bar global search |
| `print.ts` | Server-side PDF rendering via Playwright (PDF Templates) |
| `sql-report.ts`, `code-report.ts`, `reports/` | SQL Reports and Code Reports |
| `report-chart.ts` | Chart series from saved reports, dashboard pinning |
| `storage.ts`, `thumbnails.ts` | Disk-backed file storage, signed URLs, image thumbnails |
| `webform.ts`, `website.ts` | Public web forms and server-rendered web pages |
| `settings.ts` | System Settings (a Settings Table) |
| `i18n.ts` | Translation catalogs |
| `audit.ts` | Access/activity logging |
| `apps.ts`, `sample-apps/` | Installable app registry (e.g. `hello-crm`) |
| `tenancy.ts` | Multi-site provisioning, schema-per-site isolation |
| `migrate.ts`, `patches.ts`, `run-patches.ts` | Migration and patch runners |
| `cli.ts` | Command-line entry (`pnpm --filter server cli`) |
| `smoke.ts` | The server smoke test (`pnpm --filter server test:smoke`) |
| `auto-email-report.ts` | Scheduled report emails |

### `apps/web/src/`

| Path | Purpose |
|---|---|
| `main.tsx` | App entry, providers |
| `router.tsx` | Every route; the generic table/row-view mapping |
| `index.css` | Design tokens and the `.fc-*` component classes |
| `lib/api.ts` | Fetch wrapper, token storage, `ApiError` |
| `lib/meta.ts` | `useMeta` hook, column-type constants, `listColumns` |
| `lib/realtime.ts` | WebSocket client hook |
| `lib/client-scripts.ts` | Loads and runs Client Scripts against forms |
| `lib/session.ts`, `lib/settings.ts`, `lib/theme.ts`, `lib/i18n.ts` | Session, display settings, theme, translations |
| `components/ListView.tsx` | The one list view for every Table |
| `components/FormView.tsx` | The one form view for every Table (incl. sub-table grids) |
| `components/SummaryView.tsx`, `SqlReportView.tsx`, `CodeReportView.tsx` | Report surfaces |
| `components/KanbanView.tsx`, `CalendarView.tsx`, `GanttView.tsx` | Alternate list renderings |
| `components/WorkflowActions.tsx` | Workflow action buttons on a form |
| `components/PermissionManager.tsx` | The Permission role/permission matrix editor |
| `components/DashboardView.tsx`, `HomePageView.tsx`, `JobMonitor.tsx` | Dashboards, home pages, background-job monitor |
| `components/Comments.tsx`, `ActivityTimeline.tsx`, `Assignments.tsx`, `Attachments.tsx`, `Tags.tsx` | Form sidebar features |
| `pages/AdminLayout.tsx` | The Admin shell: sidebar, Command Bar, keyboard shortcuts |
| `pages/TableBuilder.tsx` | Build a Table from the Admin UI |
| `pages/Login.tsx`, `ResetPassword.tsx`, `OAuthCallback.tsx` | Auth pages |
| `pages/Portal.tsx`, `WebForm.tsx`, `PrintView.tsx` | Customer portal, public forms, print view |

`packages/shared` holds the types and contracts both sides import — notably
`tableSchemaToZod`, the metadata-to-validation-schema generator used by the save
path.
