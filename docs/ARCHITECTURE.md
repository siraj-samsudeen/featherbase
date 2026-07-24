# Architecture

Featherbase is a metadata-driven app platform: you define a model (a
**DocType**) as JSON, and the platform generates the database table, the API,
the validation schema, and the UI from that one definition. Nothing is
hand-written per model — one save path, one list view, one form view serve
every DocType.

This document walks one request end to end, then explains the metadata engine
and the generic Desk UI, and closes with a map of the source tree.

## The life of a `save_doc` request

Everything below is traceable in two files: the route in
`apps/server/src/index.ts` and the lifecycle in `apps/server/src/document.ts`.

### 1. Route and middleware

The server is a single Hono app built in `apps/server/src/index.ts`. Before
any handler runs, three middlewares apply to `/api/*`:

- `secureHeaders()` and a CORS policy restricted to the Desk origins
  (`config.allowedOrigins`, default `http://localhost:5173`).
- The auth middleware (`app.use('/api/*', ...)` — registered after the public
  routes) resolves the caller and stores it as `c.var.user`. Credentials come
  from `authCredential()`: the `Authorization` header wins; an HttpOnly `sid`
  cookie is the fallback. That cookie is set by both `POST /api/login` and the
  Frappe-shaped `POST /api/method/login`, so Frappe-style clients work
  unchanged.
- `rateLimit` (`apps/server/src/rate-limit.ts`), keyed by the resolved user.

Token resolution lives in `apps/server/src/auth.ts` (`resolveToken`): a
`Bearer <jwt>` is verified against `JWT_SECRET` and looked up in `tab_user`;
an `Authorization: token key:secret` pair authenticates an integration via
its API key.

The route itself:

```ts
// apps/server/src/index.ts
app.post('/api/save_doc', async (c) => {
  const body = await c.req.json()          // { doctype, doc }
  const saved = await saveDoc(body.doctype, body.doc, who(c))
  publishDocEvent(body.doctype, String(saved.name), hadName ? 'updated' : 'created')
  return c.json(saved, 201)
})
```

The handler is deliberately thin: parse, call `saveDoc`, publish a realtime
event (`apps/server/src/realtime.ts`), return the saved document as JSON with
status 201.

### 2. `saveDoc` — before the transaction

`saveDoc` in `apps/server/src/document.ts` starts by loading the DocType's
metadata via `getMeta` (`apps/server/src/meta.ts`, a per-process cache over
`tab_doctype` + `tab_docfield`). Then it routes special cases:

- `DocType` / `DocField` documents are refused — schema changes must go
  through `/api/doctype` so DDL runs (the `ENGINE_MANAGED` set).
- A Single DocType (`issingle`) goes to `saveSingle`, which persists values
  into the `single_value` EAV table instead of a generated table.
- A child DocType (`istable`) is refused — child rows are only saved through
  their parent.
- If `doc.name` is set and the row exists, this is an **update** and control
  passes to `updateDoc` (see below). Otherwise it is an **insert**.

For an insert, before any SQL write:

- `assertPermission(user, doctype, 'create')` and User Permission checks
  (`apps/server/src/permissions.ts`).
- `pickFieldValues` filters the payload to declared fields — unknown keys are
  a `ValidationError` (typos fail loudly), `read_only` fields are ignored
  (they are system-managed).
- `stripUnwritableFields` drops fields above the caller's writable
  permlevels.
- `applyDefaults` fills declared `default_value`s.
- `validateValues` parses the result against a Zod schema **generated from
  the metadata** (`metaToZod` in `packages/shared`) — required fields,
  types, select options.
- `applySla` (`apps/server/src/sla.ts`) stamps response/resolution deadlines
  if an active SLA covers this DocType.
- If a Workflow governs the DocType, the workflow state field is forced to
  the initial state — a caller cannot smuggle in a later state
  (`apps/server/src/workflow.ts`).

### 3. Inside the transaction

The write happens in a single `sql.begin(...)` transaction:

1. **Naming** — `resolveName` applies the DocType's `autoname` rule: `hash`
   (random), `prompt` (client supplies the name), `field:<fieldname>`, or a
   naming series like `TASK-.####`. Series counters use
   `INSERT ... ON CONFLICT DO UPDATE` on the `series` table *inside* the
   transaction, so concurrent savers serialize on the counter row and a
   rolled-back save rolls the increment back too.
2. **Pre-write hooks** — `runHooks` (`apps/server/src/controllers.ts`) runs
   `before_insert → before_validate → validate → before_save`, interleaved
   with sandboxed Server Scripts for `validate` and `before_save`
   (`runDocEventScripts` in `apps/server/src/server-scripts.ts`). Hooks may
   mutate `ctx.doc`; any throw aborts the whole transaction.
3. **Link validation** — `validateLinks` checks every Link field references
   an existing row of its target DocType.
4. **The INSERT** into the generated `tab_*` table.
5. **Child tables** — `saveChildren` writes each `Table` field's rows into
   the child DocType's table (with `parent`, `parenttype`, `parentfield`
   linkage), in the same transaction. On update, rows omitted from the
   payload are deleted — the payload is authoritative.
6. **Post-write hooks** — `after_insert → after_save → on_update`, plus
   `after_save` Server Scripts.

The update path (`updateDoc`) differs in a few ways: it takes the row with
`SELECT ... FOR UPDATE`, enforces **optimistic concurrency** (the client must
echo the `modified` timestamp it loaded; a mismatch is a 409
`ConflictError`), refuses writes to submitted/cancelled documents
(`docstatus` 1/2), blocks direct edits to a workflow-controlled state field,
and records a field-level diff into `tab_version` (`recordVersion`) when the
DocType has `track_changes`.

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

Submit and cancel (`submitDoc` / `cancelDoc` → `setDocstatus`) run their own
hook order — `before_submit`/`before_cancel` before the write, then
`on_update` and `on_submit`/`on_cancel` — matching Frappe.

### 5. The response

The saved row is re-read with child tables attached (`loadChildren`) and
passed through `stripInternalColumns`, which drops anything that is not a
standard column or a declared DocField, and always drops credential columns
(`password_hash`, `api_secret_hash`, ...). The client gets plain JSON of the
document.

Errors follow one envelope everywhere (`apps/server/src/errors.ts`): an
`AppError` maps to a status code (Frappe's convention of **417** for
business validation), a body with `error: { type, message, fields? }`, and a
top-level `exc_type` carrying the Frappe exception-class name
(`DoesNotExistError` for 404s) — deliberate wire parity so Frappe clients
can parse failures.

## The hook chain

`apps/server/src/controllers.ts` keeps a registry of per-DocType controllers.
Each file in `apps/server/src/controllers/` default-exports a
`DocTypeController` (`{ doctype, hooks }`) and is auto-loaded at boot. The
events, in Frappe's order:

```
insert: before_insert -> before_validate -> validate -> before_save
        -> INSERT -> after_insert -> after_save -> on_update
update: before_validate -> validate -> before_save
        -> UPDATE -> after_save -> on_update
```

plus `before_submit`/`on_submit`, `before_cancel`/`on_cancel`, and
`on_trash`. A controller registered under the wildcard DocType `'*'` runs for
every DocType (Frappe's `doc_events["*"]`), after the specific ones. Hooks
receive a `HookContext` with the doc, the old row (on update), the metadata,
the acting user, and the open transaction handle.

## The metadata engine

`apps/server/src/doctype-engine.ts` turns a DocType JSON definition into a
real Postgres table.

A definition is validated by `doctypeDefSchema` (Zod): a name, flags
(`issingle`, `istable`, `is_submittable`), an `autoname` rule, and a list of
fields, each with `fieldname` (snake_case), `fieldtype`, `options`, and flags
like `reqd`, `unique`, `in_list_view`, `permlevel`.

`createDocType`:

1. Inserts one row into `tab_doctype` and one per field into `tab_docfield` —
   the metadata *is* data.
2. Generates `CREATE TABLE "tab_<name>"` from the fields. Every table gets
   the standard columns (`name` PK, `owner`, `creation`, `modified`,
   `modified_by`, `docstatus`, `idx`); child tables additionally get
   `parent`/`parenttype`/`parentfield`. Field types map to column types in
   the `COLUMN_TYPES` table (`Data` → `varchar(140)`, `Currency` →
   `numeric(21,9)`, `JSON` → `jsonb`, ...). Layout fields (`Section Break`,
   `Column Break`) and `Table` fields produce no column.
3. Enables row-level security and generates a SELECT-only policy for the
   `desk_client` role (`applyRls`) — the local stand-in for a direct
   PostgREST-style client. The app server connects as the table owner and
   remains the only write path (see `apps/server/migrations/0010_rls.sql`).

`updateDocType` syncs an edited definition: new fields add columns
(`ALTER TABLE ... ADD COLUMN`), property edits update `tab_docfield` rows,
removed fields delete the docfield but **keep** the column unless
`drop_columns` is passed, and fieldtype changes are rejected outright.

Singles get no table at all — their values live in the `single_value` EAV
table, one row per field.

## The generic Desk UI

The web app never knows about specific DocTypes. Two facts make that work:

**Metadata comes from the server.** `useMeta` in `apps/web/src/lib/meta.ts`
fetches `GET /api/meta/:doctype` (registered in `apps/server/src/index.ts`)
and caches it via TanStack Query. Everything the UI renders — labels, field
types, list columns, required flags — derives from that response.
`listColumns` picks the list view's columns: `name` first, then fields
flagged `in_list_view` (or the first two data fields when none are flagged),
matching Frappe.

**Routes are generic.** `apps/web/src/router.tsx` defines:

- `/desk/$doctype` → `ListView` (`apps/web/src/components/ListView.tsx`),
  with filters kept in the URL. A Single DocType renders its one `FormView`
  directly.
- `/desk/$doctype/$name` → `FormView`
  (`apps/web/src/components/FormView.tsx`). The literal name `new` means a
  blank unsaved document (`const isNew = name === 'new'`).
- `/desk/new-doctype` → the DocType Builder
  (`apps/web/src/pages/DocTypeBuilder.tsx`), which POSTs to `/api/doctype`.
- Additional generic views: `$doctype/view/report|kanban|calendar|gantt`,
  `query-report/$name`, `script-report/$name`, `workspace/$name`,
  `dashboard/$name`, `permissions/$doctype`, `jobs`.

`FormView` loads the document with `GET /api/resource/:doctype/:name`,
renders an input per field from the metadata, and saves with
`POST /api/save_doc` — the exact endpoint traced above, echoing back
`modified` for the concurrency check. `DeskLayout`
(`apps/web/src/pages/DeskLayout.tsx`) builds the sidebar by listing the
`DocType` DocType itself (`/api/resource/DocType` with
`istable = false`), and hosts the awesomebar (`GET /api/search`,
Ctrl/Cmd+K).

Adding a DocType therefore requires zero frontend code: define it, and
`/desk/YourDocType` works.

## Frappe wire compatibility

Deliberate, load-bearing parity (do not "clean up"):

- `POST /api/method/login` returns Frappe's `{ message, home_page,
  full_name }` shape and sets the `sid` cookie (`apps/server/src/index.ts`).
- Error bodies carry `exc_type` (`apps/server/src/errors.ts`).
- `GET|POST /api/method/:path` dispatches whitelisted RPC methods
  (`apps/server/src/methods.ts`), including the `frappe.client.*` namespace
  (`apps/server/src/methods/frappe-client.ts`) that frappe-js-sdk calls.
- `/api/resource/:doctype[/:name]` is the Frappe-style REST resource: one
  generic handler set for CRUD on every DocType.

## Project map

### `apps/server/src/`

| Path | Purpose |
|---|---|
| `index.ts` | The Hono app: every route, middleware order, server boot, worker/scheduler startup |
| `config.ts` | Port, `DATABASE_URL` default, allowed CORS origins |
| `db.ts` | The `postgres` client (no ORM) and the test-sandbox delegate hook |
| `meta.ts` | DocType metadata loader + per-process cache (`getMeta`, `invalidateMeta`) |
| `doctype-engine.ts` | DocType JSON → DDL: create/update tables, standard columns, RLS policies |
| `document.ts` | The document lifecycle: save/update/submit/cancel/amend/delete/rename, naming, child tables, versioning |
| `controllers.ts` + `controllers/` | Hook registry and per-DocType controllers (auto-loaded at boot) |
| `query.ts` | Permission-scoped list queries (`getList`, `countDocs`, `groupCount`) |
| `permissions.ts` | DocPerm checks, permlevels, if_owner, User Permissions, shares |
| `auth.ts` | Login, JWT sessions, scrypt password hashing, API keys |
| `oauth.ts` | Google OAuth flow with a dev mock provider |
| `password-reset.ts` | Reset request + token redemption |
| `rate-limit.ts` | Per-user request throttling |
| `errors.ts` | `AppError`, status mapping, the `exc_type` error envelope |
| `methods.ts` + `methods/` | `/api/method` RPC whitelist, incl. `frappe-client.ts` |
| `workflow.ts` | Workflow states/transitions, role-gated actions |
| `server-scripts.ts` | Sandboxed (node:vm) Server Scripts + workflow condition evaluation |
| `custom-fields.ts` | Apply Custom Field records (column + docfield) |
| `customizations.ts` | Export/import Custom Fields + Property Setters as JSON |
| `email.ts`, `email-rules.ts` | Email queue/delivery and notification rules |
| `assign.ts`, `assignment-rules.ts` | Assignments (ToDo + notify) and auto-assignment rules |
| `sla.ts` | SLA deadline stamping and escalation support |
| `webhooks.ts` | Outbound webhooks on lifecycle events |
| `jobs.ts` + `jobs/` | Background job queue (`tab_background_job`), worker, handlers |
| `realtime.ts` | WebSocket server, doc/user event publishing |
| `search.ts` | Awesomebar global search |
| `print.ts` | Server-side PDF rendering via Playwright |
| `query-report.ts`, `script-report.ts`, `reports/` | Query Reports (SQL) and Script Reports (code) |
| `report-chart.ts` | Chart series from saved reports, dashboard pinning |
| `storage.ts`, `thumbnails.ts` | Disk-backed file storage, signed URLs, image thumbnails |
| `webform.ts`, `website.ts` | Public web forms and server-rendered web pages |
| `settings.ts` | System Settings (a Single DocType) |
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
| `router.tsx` | Every route; the generic `$doctype` / `$doctype/$name` mapping |
| `index.css` | Design tokens and the `.fc-*` component classes |
| `lib/api.ts` | Fetch wrapper, token storage, `ApiError` |
| `lib/meta.ts` | `useMeta` hook, field-type constants, `listColumns` |
| `lib/realtime.ts` | WebSocket client hook |
| `lib/client-scripts.ts` | Loads and runs Client Scripts against forms |
| `lib/session.ts`, `lib/settings.ts`, `lib/theme.ts`, `lib/i18n.ts` | Session, display settings, theme, translations |
| `components/ListView.tsx` | The one list view for every DocType |
| `components/FormView.tsx` | The one form view for every DocType (incl. child-table grids) |
| `components/ReportView.tsx`, `QueryReportView.tsx`, `ScriptReportView.tsx` | Report surfaces |
| `components/KanbanView.tsx`, `CalendarView.tsx`, `GanttView.tsx` | Alternate list renderings |
| `components/WorkflowActions.tsx` | Workflow action buttons on a form |
| `components/PermissionManager.tsx` | The DocPerm role/permission matrix editor |
| `components/DashboardView.tsx`, `WorkspaceView.tsx`, `JobMonitor.tsx` | Dashboards, workspaces, background-job monitor |
| `components/Comments.tsx`, `ActivityTimeline.tsx`, `Assignments.tsx`, `Attachments.tsx`, `Tags.tsx` | Form sidebar features |
| `pages/DeskLayout.tsx` | The Desk shell: sidebar, awesomebar, keyboard shortcuts |
| `pages/DocTypeBuilder.tsx` | Build a DocType from the Desk (`/desk/new-doctype`) |
| `pages/Login.tsx`, `ResetPassword.tsx`, `OAuthCallback.tsx` | Auth pages |
| `pages/Portal.tsx`, `WebForm.tsx`, `PrintView.tsx` | Customer portal, public forms, print view |

`packages/shared` holds the types and contracts both sides import — notably
`metaToZod`, the metadata-to-validation-schema generator used by the save
path.
