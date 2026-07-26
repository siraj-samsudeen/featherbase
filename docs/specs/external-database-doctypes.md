# Feature: External Database DocTypes

> Status: **proposed** (research 2026-07-26 — see
> `docs/research/frappe-multi-app-multi-db.md` for the Frappe corollary and
> the audit showing none of this exists in Featherbase yet). No code written.
> Frappe's equivalent is the hand-coded Virtual DocType; this spec makes the
> same capability *declarative*, which Frappe cannot do.

**Workflow Context:**
> A control schema lives in a Railway-hosted Postgres. Its tables hold real,
> live data written continuously by CLI tools. The user wants a Featherbase
> management app (Desk list + form views, permissions, hooks) on top of that
> schema — while every other app keeps using the local Postgres.

Pain points: today the control schema is managed by raw SQL and ad-hoc CLI
output; there is no UI, no permissions, no audit. Featherbase can only serve
DocTypes whose tables it created itself, in the one `DATABASE_URL` database.

Opportunity: let a DocType's *storage* live in a registered external
Postgres, adopted from the existing tables as-is — no change to that schema,
no interruption to the CLIs, zero per-table glue code.

**Goal:** An app's DocTypes can be backed by tables in an external Postgres,
adopted without modifying them, and served through the same generic Desk,
API, permission, and hook machinery as local DocTypes.

## Scope

**In:** named external connections; adopting existing tables as DocTypes via
introspection; generic list/form views over them; server-mediated reads and
writes with lifecycle hooks; safe coexistence with outside writers; binding
an app manifest to a connection.

**Out:** cross-database joins and Link fields spanning connections; syncing /
copying external data locally; any DDL against external databases; sources
other than Postgres; transactions spanning two databases; realtime push for
externally-made changes; child tables and submittable docs on external
DocTypes (v1).

## Dependencies

- Requires: DocType engine (META-001..005), app system (PLAT-001/002),
  permission engine (PERM-*).
- Blocked by: nothing — additive; local DocTypes are untouched.

---

## XDB-1: Connection Registry

- WHEN a System Manager registers a connection with a name and the name of an
  environment variable holding its URL, THE SYSTEM SHALL probe connectivity
  and record the connection.
- THE SYSTEM SHALL read credentials only from the environment at boot/use
  time and SHALL NOT store URLs or passwords in the database.
- IF the environment variable is unset or the probe fails, THEN THE SYSTEM
  SHALL reject registration naming the variable and the connection error.
- THE SYSTEM SHALL never execute DDL over an external connection.

**Examples:**

| Input | Result |
|-------|--------|
| name `railway`, env var `EXTERNAL_DB_RAILWAY` (set, reachable) | connection saved, shown "reachable" |
| name `railway`, env var unset | rejected: "EXTERNAL_DB_RAILWAY is not set" |

## XDB-2: Table Adoption (reflection)

- WHEN a System Manager adopts a table from a registered connection, THE
  SYSTEM SHALL introspect its columns, keys, and nullability and generate a
  DocType whose fields mirror them, recording connection, physical table
  name, and primary-key column in the DocType definition.
- THE SYSTEM SHALL adopt the table exactly as it is: no renaming, no added
  columns, no requirement for Featherbase standard columns (`name`, `owner`,
  `creation`, …).
- WHEN the external table has no single-column primary or unique key, THE
  SYSTEM SHALL adopt it read-only.
- WHEN the external table changes shape later (columns added/removed), THE
  SYSTEM SHALL offer a metadata re-sync showing the diff — and SHALL NOT
  alter the table in either direction.
- IF a column's type has no Featherbase fieldtype mapping, THEN THE SYSTEM
  SHALL adopt that column as read-only text rather than failing the adoption.

**Examples:**

| Input | Result |
|-------|--------|
| adopt `railway`.`deployments` (id uuid pk, app_name text, status text, created_at timestamptz) | DocType "Deployment": 3 editable fields + pk mapping, list/form work immediately |
| adopt `railway`.`event_log` (no pk) | DocType created read-only; saves rejected |
| CLI migration adds column `region` to `deployments` | re-sync shows "+ region (text)"; accepting adds the field, table untouched |

## XDB-3: Desk and API over External DocTypes

- WHEN a user opens an external DocType in the Desk, THE SYSTEM SHALL render
  the standard ListView and FormView from metadata with zero frontend code,
  with filtering, sorting, and pagination executed on the external
  connection.
- THE SYSTEM SHALL serve every read live from the external database — no
  local copies or caches of row data — so rows written by the CLIs appear on
  the next load.
- IF the external database is unreachable, THEN THE SYSTEM SHALL show an
  error state for that DocType only; the rest of the Desk and all local
  DocTypes stay functional.

**Examples:**

| Before | Action | After |
|--------|--------|-------|
| CLI inserts a `deployments` row | user opens Deployment list | new row is in the list |
| Railway DB down | user opens Deployment list | "connection railway unreachable" banner; local DocTypes unaffected |

## XDB-4: Writes Through the Server

- WHEN a user saves or deletes an external document, THE SYSTEM SHALL run the
  standard lifecycle chain (`validate` → `before_save` → external write →
  `after_save`) and write only through the server.
- THE SYSTEM SHALL identify documents by the mapped primary-key column and
  update only the columns changed in the form.
- IF the external write fails, THEN THE SYSTEM SHALL surface the database
  error and leave no partial local state (audit/log rows for the attempt are
  allowed and marked failed).
- IF the row was changed by another writer since it was loaded (checked via
  an updated-at column when the table has one), THEN THE SYSTEM SHALL reject
  the save with a conflict error instead of overwriting.

**Examples:**

| Before | Action | After |
|--------|--------|-------|
| Deployment `d1` status `queued` | user sets status `cancelled`, saves | external row updated; hooks ran; CLI sees `cancelled` |
| user loaded `d1`, CLI then updated it | user saves | conflict error, no overwrite |

## XDB-5: App Binding

- WHEN an app manifest declares a connection and adopted tables, THE SYSTEM
  SHALL bind that app's DocTypes to that connection at install time (other
  apps' DocTypes stay on the local database).
- WHEN such an app is uninstalled, THE SYSTEM SHALL remove only Featherbase
  metadata; the external tables and their data SHALL be untouched (unlike
  local app uninstall, which drops owned tables).

**Examples:**

| Input | Result |
|-------|--------|
| install `control-panel` app (connection `railway`, tables `deployments`, `services`) | 2 external DocTypes appear under the app's module |
| uninstall `control-panel` | DocTypes gone from Desk; Railway tables and rows intact |

---

## Rules

**Business Validation**
- BV1!: No DDL statement (CREATE/ALTER/DROP/TRUNCATE) is ever issued over an
  external connection — not on adopt, sync, install, uninstall, or delete.
- BV2!: Deleting an external DocType or uninstalling its app removes metadata
  only; external rows are never deleted by lifecycle operations other than an
  explicit user "delete document".
- BV3: External DocTypes cannot be `issingle`, `istable`, or submittable
  (v1); naming series do not apply — identity comes from the external
  primary key.

**Permissions**
- P1: Role permissions and DocPerms apply to external DocTypes identically to
  local ones, enforced server-side.
- P2: Postgres RLS (which guards local `tab_*` tables) does not extend to
  external connections; the server-side permission check is the sole gate and
  must therefore run on every external read and write path.

**Input Validation**
- IV1: Connection names are lowercase slugs, unique.
- IV2: An adopted DocType's fieldnames are the external column names
  verbatim (reserved standard-column names allowed here, since the table is
  external).

**State Rules**
- S1: A registered connection that becomes unreachable degrades only its own
  DocTypes (XDB-3); background jobs touching them log and retry rather than
  crash the worker.

**Data Model**
- T1: external connection registry — name, environment-variable name,
  optional description. (No secrets.)
- T2: DocType definition gains optional external-storage metadata —
  connection name, physical table name, primary-key column, read-only flag.
  Absent = local DocType, behavior unchanged.

## Out of Scope (restated hard exclusions)

- Link fields / joins between DocTypes on different connections.
- Two-phase or distributed transactions; a save touching an external row and
  local rows (audit, jobs) is two commits, and the spec accepts that.
- Non-Postgres external sources (APIs, files, MySQL) — the Frappe Virtual
  DocType generality is deliberately narrowed to Postgres for v1.
- Realtime/websocket notification of external changes (reads are live;
  pushes are not).
