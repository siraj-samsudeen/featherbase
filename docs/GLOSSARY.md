# Glossary

Featherbase's own vocabulary. Each entry says what the thing is and where it
lives here.

This project began as a faithful replication of [Frappe
Framework](https://frappe.io/framework), and several of these terms still
carry a parenthetical note of the Frappe-era word for readers coming from
Frappe. But this is no longer "Frappe vocabulary as it applies to this
codebase" — the project has since diverged from Frappe on purpose (see
[ADR 0006](adr/0006-stack-react-hono-postgres.md)'s addendum), and the terms
below, not Frappe's, are the source of truth for this platform.

**Table** (formerly Frappe's "DocType") — the central concept: a model
defined as metadata. A Table's definition (columns, flags, id pattern) lives
as rows in `table_def` and `column_def`; the engine
(`apps/server/src/table-engine.ts`) generates a real table (a bare
`<name>`, with no `tab_` prefix) from it, and the API and UI are derived
from the same metadata. Created through the table-definition endpoint or the
Admin's Table Builder (`apps/web/src/pages/TableBuilder.tsx`).

**Row** (formerly Frappe's "Document"/"Doc") — one record in a Table. Rows
carry the standard columns every Table gets: `name` (primary key),
`created_by`, `created_at`, `updated_at`, `updated_by`, `status`, `position`
(see their own entries below). Saving, updating, submitting, cancelling, and
deleting a Row all run through the server's row lifecycle
(`apps/server/src/document.ts`), never directly against Postgres.

**Column** (formerly Frappe's "Field") — one attribute of a Table: a name,
a type (`Data`, `Reference`, `Choice`, ...), and flags (required, unique,
shown in list view, tier). What used to be a single overloaded `options`
string on a column definition is now split by type: `reference_table` (the
target Table for a Reference column), `choices` (the fixed value list for a
Choice column), and `row_table` (the target Table for a Sub-table column).

**Admin** (formerly Frappe's "Desk") — the back-office UI where operators
work with rows; distinct from public-facing pages. It's the React app's
operator-facing routes (`apps/web/src/router.tsx`), with the shell —
sidebar, Command Bar, avatar — in `apps/web/src/pages/AdminLayout.tsx`.

**Id pattern** (formerly Frappe's "naming series"/`autoname`) — the rule
that names a new Row: a series like `TASK-.####` names rows sequentially
(`TASK-0001`, `TASK-0002`, ...), implemented in `resolveName`
(`apps/server/src/document.ts`) with the counter as a row in the `series`
table, incremented with `INSERT ... ON CONFLICT` inside the save
transaction so names stay unique and gapless under concurrency. Other id
pattern kinds: `hash` (default, random), `prompt` (caller supplies the
name), and `field:<column>` (name copied from another column's value).

**Sub-table** (formerly Frappe's "child table") — a Table whose `kind` is
`sub_table`, whose rows exist only inside a parent Row, through a parent
column of type Sub-table (pointing at it via `row_table`). Sub-table rows
carry `parent`, `parenttype`, and `parentfield` columns and are saved,
loaded, and deleted with the parent in one transaction (`saveChildren` /
`loadChildren` in `apps/server/src/document.ts`). Example: `Workflow` holds
`Workflow Row State` and `Workflow Transition` sub-tables
(`apps/server/migrations/0015_workflow.ts`).

**Settings Table** (formerly Frappe's "Single DocType") — a Table whose
`kind` is `settings`: exactly one instance, no generated table; think System
Settings. Values are stored per-column in the `single_value` EAV table
(`getSingle` / `saveSingle` in `apps/server/src/document.ts`), and the Row's
name is the Table's own name. The Admin UI opens its form directly instead
of a list.

**Permission** (formerly Frappe's "DocPerm") — a role-based permission row
for a Table: which role may read/write/create/delete/submit/cancel/amend, at
which tier. Enforced by `apps/server/src/permissions.ts`, edited from the
Admin's Permission Manager (`apps/web/src/components/PermissionManager.tsx`).

**Tier** (formerly Frappe's numeric `permlevel`, 0–9) — a per-column
permission level, now `basic` or `restricted` instead of a 0–9 scale. Each
Column has a tier; a role's Permission at that tier grants read/write on
those columns. On save, columns above the caller's writable tier are
silently stripped (`stripUnwritableFields`); on read, columns above readable
tiers are omitted (`filterReadFields`) — both in
`apps/server/src/permissions.ts`.

**Own rows only** (formerly Frappe's `if_owner`) — a Permission flag meaning
"this grant applies only to rows the user created" (the `created_by`
column). Implemented in `apps/server/src/permissions.ts`; it's also what
makes the customer Portal show a user only their own rows.

**Data Scope** (formerly Frappe's "User Permission") — a per-user data
restriction: "this user may only see rows linked to Company A." Stored as
Data Scope rows (`user`, `allow` = the Table, `for_value`), enforced against
every Reference column on read and write (`checkUserPermissions` in
`apps/server/src/permissions.ts`, `assertUserPermissions` in
`apps/server/src/document.ts`).

**Share** (formerly Frappe's "DocShare") — a one-off read/write/submit grant
of a single Row to a specific user or role, outside the normal Permission
matrix — how you hand one person access to one Row without changing
Table-wide rules.

**Reference / Choice** — the two column types renamed from Frappe's `Link`
and `Select`. A Reference column points at another Table by name (its target
is the column's `reference_table`) and is checked for referential integrity
on every save (`validateLinks`); a Choice column restricts values to a fixed
list (the column's `choices`).

**Workflow** — role-gated state machines over a Table. A `Workflow` row
(`apps/server/migrations/0015_workflow.ts`) holds states (each mapping to a
Row's `status`) and transitions (each allowed to a Role). The engine
(`apps/server/src/workflow.ts`) forces new Rows into the initial state,
blocks direct edits of the state column, and applies transitions through the
`apply_workflow_action` action; the form shows available actions via
`apps/web/src/components/WorkflowActions.tsx`.

**Server Script** — admin-authored code that runs on the server without a
deploy: either on an automation trigger (on check, before saving, after
saving — inside the save transaction) or as a callable API method. Stored as
Server Script rows (`apps/server/migrations/0037_server_script.ts`) and
executed in a hardened `node:vm` sandbox that exposes only the row / call
arguments and a `throw`-style helper — no host objects
(`apps/server/src/server-scripts.ts`).

**Client Script** — user JS that hooks into form events in the browser
(onload, column change, before saving). Stored as Client Script rows
(`apps/server/migrations/0038_client_script.ts`), loaded and run by the
Admin UI via `apps/web/src/lib/client-scripts.ts`.

**Custom Field** — a column added to an existing Table as data rather than
by editing its definition — the mechanism for site-local extensions that
survive upstream re-seeds. A Custom Field record
(`apps/server/migrations/0016_custom_field.ts`) is applied by
`apps/server/src/custom-fields.ts` (adds the physical column and a
column-definition row marked custom) and re-applied at boot
(`reapplyCustomFields` in `apps/server/src/index.ts`).

**Metadata Override** (formerly Frappe's "Property Setter" — renamed rather
than "Field Override" since it can override Table-level properties too, not
just a column's) — a stored override of a single metadata property ("label
of `status` on `Task` is now 'State'") without touching the base definition.
Applied as an overlay when metadata is loaded; any change invalidates the
target's meta cache (`apps/server/src/controllers/property-setter.ts`,
`apps/server/migrations/0017_property_setter.ts`).

**Web Form** — a public, optionally anonymous form over a whitelisted subset
of one Table's columns. Submissions go through the normal save lifecycle so
server validation still applies, and render at `/form/:route`
(`apps/web/src/pages/WebForm.tsx`).

**Portal** — the customer-facing counterpart to the Admin UI: a logged-in
website user sees only their own rows (scoped by "own rows only" in the
API). Routes `/portal/:table[/:name]` in `apps/web/src/router.tsx`, pages in
`apps/web/src/pages/Portal.tsx`.

**Command Bar** (formerly Frappe's "Awesomebar") — the global search box in
the Admin UI's top bar (focus with Ctrl/Cmd+K). It matches row names and
title columns across every Table the user can read, and doubles as a command
palette (jump to a Table, new Row, new Table).

**Home Page** (formerly Frappe's "Workspace") — a configurable module
landing page of shortcut cards (links to Table lists, reports, dashboards).
Stored as Home Page rows with a JSON `shortcuts` column
(`apps/server/migrations/0036_workspace.ts`), rendered by
`apps/web/src/components/HomePageView.tsx`.

**Summary View / SQL Report / Code Report** (formerly Frappe's "Report
View" / "Query Report" / "Script Report") — the three saved-report kinds. A
Summary View is a saved list configuration (filters, columns, sort) over one
Table; a SQL Report runs a stored, parameterized SQL query
(`apps/server/src/sql-report.ts`); a Code Report runs admin-authored code
against the database and returns a table/chart
(`apps/server/src/code-report.ts`).

**PDF Template** (formerly Frappe's "Print Format") — a per-Table layout
used to render a Row as a PDF, generated server-side via Playwright
(`apps/server/src/print.ts`).
