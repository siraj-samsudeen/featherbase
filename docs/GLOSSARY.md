# Glossary

Frappe vocabulary, as it applies to this codebase. Each entry says what the
thing is and where it lives here.

**DocType** — the central concept: a model defined as metadata. A DocType's
definition (fields, flags, naming rule) lives as rows in `tab_doctype` and
`tab_docfield`; the engine (`apps/server/src/doctype-engine.ts`) generates a
real `tab_<name>` table from it, and the API and UI are derived from the
same metadata. Created via `POST /api/doctype` or the Desk's DocType Builder
(`apps/web/src/pages/DocTypeBuilder.tsx`).

**Desk** — the back-office UI where operators work with documents; distinct
from public-facing pages. Here it's the React app under `/desk` routes
(`apps/web/src/router.tsx`), with the shell — sidebar, awesomebar, avatar —
in `apps/web/src/pages/DeskLayout.tsx`.

**Naming series** — an `autoname` rule like `TASK-.####` that names new
documents sequentially (`TASK-0001`, `TASK-0002`, ...). Implemented in
`resolveName` (`apps/server/src/document.ts`): the counter is a row in the
`series` table, incremented with `INSERT ... ON CONFLICT` inside the save
transaction, so names are unique and gapless even under concurrency. Other
`autoname` rules: `hash` (default), `prompt` (caller supplies the name), and
`field:<fieldname>`.

**Child table** — a DocType with `istable: true` whose rows exist only
inside a parent document, through a parent field of type `Table`. Child rows
carry `parent`, `parenttype`, and `parentfield` columns and are saved,
loaded, and deleted with the parent in one transaction (`saveChildren` /
`loadChildren` in `apps/server/src/document.ts`). Example: `Workflow` holds
`Workflow Document State` and `Workflow Transition` children
(`apps/server/migrations/0015_workflow.ts`).

**DocPerm** — a role-based permission row for a DocType: which role may
read/write/create/delete/submit/cancel/amend, at which permlevel. Stored in
`tab_docperm`, enforced by `apps/server/src/permissions.ts`, edited from the
Desk's Permission Manager (`/desk/permissions/:doctype`,
`apps/web/src/components/PermissionManager.tsx`) via
`GET/POST /api/permissions/:doctype`.

**permlevel** — a per-field permission tier (0–9). Each DocField has a
`permlevel`; a role's DocPerm at that level grants read/write on those
fields. On save, fields above the caller's writable levels are silently
stripped (`stripUnwritableFields`); on read, fields above readable levels
are omitted (`filterReadFields`) — both in
`apps/server/src/permissions.ts`.

**if_owner** — a DocPerm flag meaning "this grant applies only to documents
the user owns" (`owner` column). Implemented in
`apps/server/src/permissions.ts` (PERM-007); it's also what makes the
customer Portal show a user only their own documents.

**User Permission** — a per-user data restriction: "this user may only see
documents linked to Company A". Stored as `User Permission` documents
(`apps/server/migrations/0007_user_permission.ts`: `user`, `allow` = the
DocType, `for_value`), enforced against every Link field on read and write
(`checkUserPermissions` in `apps/server/src/permissions.ts`,
`assertUserPermissions` in `apps/server/src/document.ts`).

**Single DocType** — a DocType with `issingle: true` that has exactly one
instance and no table; think of System Settings. Values are stored per-field
in the `single_value` EAV table (`getSingle` / `saveSingle` in
`apps/server/src/document.ts`), and the document's name is the DocType name.
The Desk opens its form directly instead of a list.

**Workflow** — role-gated state machines over a DocType. A `Workflow`
document (`apps/server/migrations/0015_workflow.ts`) holds states (each
mapping to a docstatus) and transitions (each allowed to a Role). The engine
(`apps/server/src/workflow.ts`) forces new documents into the initial state,
blocks direct edits of the state field, and applies transitions through
`POST /api/apply_workflow_action`; the form shows available actions via
`apps/web/src/components/WorkflowActions.tsx`.

**Server Script** — admin-authored code that runs on the server without a
deploy: either on document events (`validate`, `before_save`, `after_save`,
inside the save transaction) or as a callable API method. Stored as `Server
Script` documents (`apps/server/migrations/0037_server_script.ts`) and
executed in a hardened `node:vm` sandbox that exposes only `doc`/`args` and
`frappe.throw` — no host objects (`apps/server/src/server-scripts.ts`).

**Client Script** — user JS that hooks into form events in the browser
(onload, field change, before save). Stored as `Client Script` documents
(`apps/server/migrations/0038_client_script.ts`), loaded and run by the Desk
via `apps/web/src/lib/client-scripts.ts`.

**Custom Field** — a field added to an existing DocType as data rather than
by editing its definition — the mechanism for site-local extensions that
survive upstream re-seeds. A `Custom Field` record
(`apps/server/migrations/0016_custom_field.ts`) is applied by
`apps/server/src/custom-fields.ts` (adds the column and a docfield row
marked custom) and re-applied at boot (`reapplyCustomFields` in
`apps/server/src/index.ts`).

**Property Setter** — a stored override of a single metadata property
("label of `status` on `Task` is now 'State'") without touching the base
definition. Applied as an overlay when metadata is loaded; any change
invalidates the target's meta cache
(`apps/server/src/controllers/property-setter.ts`,
`apps/server/migrations/0017_property_setter.ts`).

**Web Form** — a public, optionally anonymous form over a whitelisted subset
of one DocType's fields. Config and submission run through
`GET/POST /api/web_form/:route` (`apps/server/src/webform.ts`) — submissions
go through the normal save lifecycle so server validation still applies —
and render at `/form/:route` (`apps/web/src/pages/WebForm.tsx`).

**Portal** — the customer-facing counterpart to the Desk: a logged-in
website user sees only their own documents (if_owner-scoped by the API).
Routes `/portal/:doctype[/:name]` in `apps/web/src/router.tsx`, pages in
`apps/web/src/pages/Portal.tsx`.

**Awesomebar** — the global search box in the Desk's top bar (focus with
Ctrl/Cmd+K). It matches document names and title fields across every DocType
the user can read, via `GET /api/search`
(`apps/server/src/search.ts`, UI in `apps/web/src/pages/DeskLayout.tsx`),
and doubles as a command palette (jump to a DocType, new document, new
DocType).

**Workspace** — a configurable module home page of shortcut cards (links to
DocType lists, reports, dashboards). Stored as `Workspace` documents with a
JSON `shortcuts` field (`apps/server/migrations/0036_workspace.ts`),
rendered at `/desk/workspace/:name` by
`apps/web/src/components/WorkspaceView.tsx`.
