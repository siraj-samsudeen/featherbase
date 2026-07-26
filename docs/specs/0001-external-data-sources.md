# Feature: External Data Sources — DocTypes bound to existing Postgres tables

Status: **Proposed** — not implemented. Written 2026-07-26.
Decision record: `docs/adr/0007-app-and-database-topology.md`.
Background: `docs/research/frappe-multi-app-and-multi-db.md`.

## Workflow Context

> "I have a control schema in a Railway-hosted Postgres. Real data is being
> populated into it by CLIs. I want to put a management app on top of that
> schema. Does this require any change to that schema, or can I just put it on
> top?"

Pain points: the data already exists and keeps changing under a tool
Featherbase does not control; copying it makes the management app wrong; and
today a DocType can only ever mean "a table Featherbase created, named
`tab_<doctype>`, in the one database `DATABASE_URL` points at".

Opportunity: a Desk over foreign tables — list, filter, sort, open, edit,
comment, attach, assign, permission — with **no change to the foreign schema**
for the base case, and an honest, enumerated list of the features that do need
a column to exist.

## Goal

Let a DocType read and write an existing table in another Postgres database, so
a Featherbase app can manage data it did not create and does not exclusively own.

## Scope

**In:** a Data Source registry; introspection of a source's schemas, tables and
columns; binding a DocType to `{source, schema, table}` with a column map;
generated DocTypes from introspection; the full read path (get, list, filter,
sort, paginate, count) executed as SQL on the source; the write path (insert,
update, delete) with a read-only mode; conflict detection; schema-drift
detection; Desk parity; explicit failure and transaction semantics.

**Out:** cross-source joins; cross-source transactions or 2PC; DDL against a
source (Featherbase never creates, alters or drops a foreign table); replicating
foreign data into the control DB; non-Postgres engines (see
`docs/specs/0002-virtual-doctypes.md`); child tables stored on a source;
`postgres_fdw` (an optional later optimisation, not part of the contract).

## Dependencies

- **Requires:** the DocType engine and meta cache (META-001…011), the document
  engine (DOC-001…011), the permission layer (PERM-*), the app system
  (PLAT-001).
- **Triggers:** `db.ts` gains a per-DocType client resolver; `doctype-engine.ts`
  DDL and RLS generation must skip bound DocTypes; the migration runner must
  skip them; the test harness needs a second sandbox.
- **Blocked by:** nothing.

---

## EDS-1: Register a data source

- WHEN an administrator saves a `Data Source` naming an engine and the **name of
  an environment variable** holding its connection string, THE SYSTEM SHALL
  store the source and open no connection until first use.
- WHEN an administrator triggers *Test Connection*, THE SYSTEM SHALL connect,
  record `status`, `last_checked_at` and, on failure, `last_error`.
- IF the named environment variable is unset or empty at connect time, THEN THE
  SYSTEM SHALL fail with a message naming the variable and SHALL NOT fall back
  to the control database.
- THE SYSTEM SHALL NOT store a connection string, password or any other secret
  in the database, in an export, in a Version row, or in an error message.
- THE SYSTEM SHALL keep one bounded pool per source, sized by `pool_max`.

**Examples:**

| Input | Result |
|---|---|
| name `railway-control`, engine `Postgres`, url env `RAILWAY_CONTROL_URL`, access `read_write`, pool max `5` | Source saved, status `untested` |
| Test Connection, variable set and reachable | status `ok`, `last_checked_at` stamped |
| Test Connection, variable unset | status `error`, message "RAILWAY_CONTROL_URL is not set"; no credentials echoed |

## EDS-2: Browse what a source contains

- WHEN an administrator opens a source's browser, THE SYSTEM SHALL list its
  schemas, and the tables and views in a chosen schema.
- WHEN an administrator selects a table, THE SYSTEM SHALL show each column with
  its Postgres type, nullability, default, and whether it is part of the primary
  key, plus the proposed Featherbase fieldtype for each.
- IF a table has no single-column primary key, THEN THE SYSTEM SHALL show it as
  **not bindable** and say why.
- THE SYSTEM SHALL read introspection through the same credentials the source
  uses, and SHALL NOT require any privilege beyond `SELECT` on the catalog.

**Examples:**

| Selection | Result |
|---|---|
| schema `control` | tables `tenant`, `deployment`, `job_run`, view `active_tenant` |
| table `control.tenant` | `id uuid PK → Data`, `slug text NOT NULL → Data`, `plan text → Select?`, `created_at timestamptz → Datetime`, `updated_at timestamptz → Datetime` |
| table `control.tenant_tag` (composite PK) | "Not bindable: needs a single-column primary key" |

## EDS-3: Bind a DocType to an existing table

- WHEN an administrator generates a DocType from a browsed table, THE SYSTEM
  SHALL create a DocType whose `data_source`, `external_schema`,
  `external_table` and `external_pk` are set, with one DocField per column and a
  `column_name` recorded on each field.
- WHERE a column name is not a legal fieldname, THE SYSTEM SHALL derive a legal
  `fieldname` and keep the true `column_name` for SQL.
- WHEN a bound DocType is saved, THE SYSTEM SHALL NOT emit `CREATE TABLE`,
  `ALTER TABLE`, `DROP TABLE`, or an RLS policy for it, and SHALL NOT create
  `tab_<doctype>` in the control database.
- WHEN a column is omitted from the DocType, THE SYSTEM SHALL never read it,
  write it, or reference it in a filter.
- IF a bound DocType names a column that does not exist on the source, THEN THE
  SYSTEM SHALL reject the save with a field-wise error.
- THE SYSTEM SHALL allow a DocType to be bound only at creation, and SHALL
  reject converting a local DocType to bound or a bound DocType to local.

**Examples:**

| Input | Result |
|---|---|
| Generate from `railway-control` / `control.tenant`, PK `id` | DocType `Control Tenant`, 5 fields, no `tab_control_tenant` table created |
| Column `is-active?` | fieldname `is_active`, column_name `is-active?` |
| Bound DocType saved | migration runner and DDL generator both skip it |

## EDS-4: Identity and audit columns, with no change to the foreign schema

The foreign table will not have Featherbase's standard columns. This group is
the contract that makes "just put it on top" true.

- THE SYSTEM SHALL use the bound `external_pk` column as the document `name`,
  casting non-text keys (uuid, bigint) to text on read and back on write.
- WHERE a source column is mapped to a standard column (`owner`, `creation`,
  `modified`, `modified_by`, `docstatus`, `idx`), THE SYSTEM SHALL read and
  write it as that standard column.
- WHERE no column is mapped to a standard column, THE SYSTEM SHALL synthesise it
  on read (`creation`/`modified` null, `owner`/`modified_by` null, `docstatus` 0,
  `idx` 0) and SHALL NOT attempt to write it.
- IF `docstatus` is unmapped, THEN THE SYSTEM SHALL treat every record as a
  saved draft and SHALL reject `submit`, `cancel` and `amend` for that DocType.
- IF `owner` is unmapped, THEN THE SYSTEM SHALL reject any `if_owner` DocPerm on
  that DocType at save time rather than silently granting or denying access.
- IF `modified` is unmapped, THEN THE SYSTEM SHALL apply the fallback in EDS-8.
- THE SYSTEM SHALL NOT require the foreign table to carry any Featherbase column
  in order to support list, read, create, update and delete.

**Examples:**

| Foreign column | Mapped as | Behaviour |
|---|---|---|
| `id uuid` (PK) | `name` | `GET /api/resource/Control Tenant/6f1c…` works; name is the uuid as text |
| `created_at timestamptz` | `creation` | shows in the form's audit line, never written on update |
| `updated_at timestamptz` | `modified` | optimistic locking active (EDS-8) |
| *(no owner column)* | — | `owner` reads as null; an `if_owner` perm on this DocType is rejected as a configuration error |
| *(no docstatus column)* | — | every record is a draft; Submit button absent |

## EDS-5: Listing and reading bound records

- WHEN a client calls `get_list` on a bound DocType, THE SYSTEM SHALL execute
  one `SELECT` against the source with the filters, ordering, limit and offset
  pushed down as SQL, selecting only mapped columns.
- WHEN a client calls `get_doc`, THE SYSTEM SHALL fetch the single row by the PK
  column and return the mapped fields plus the synthesised standard fields.
- WHEN a client requests a count, THE SYSTEM SHALL count on the source.
- THE SYSTEM SHALL apply DocType and permlevel permissions **before** issuing
  the query, and SHALL translate permission-derived scoping into the `WHERE`
  clause exactly as it does for local DocTypes.
- IF a filter, ordering or selected field names something that is not a mapped
  field, THEN THE SYSTEM SHALL reject the request without querying the source.
- THE SYSTEM SHALL quote schema, table and column identifiers, and SHALL pass
  every value as a bound parameter.

**Examples:**

| Request | SQL issued on the source |
|---|---|
| list `Control Tenant`, filter `plan = 'pro'`, order `created_at desc`, limit 20 | `select "id","slug","plan","created_at" from "control"."tenant" where "plan" = $1 order by "created_at" desc limit 20 offset 0` |
| filter on unmapped column `internal_notes` | 400 before any connection is used |
| user lacking read on `Control Tenant` | 403, no query issued |

## EDS-6: Creating, updating and deleting bound records

- WHEN a client saves a new document on a read-write bound DocType, THE SYSTEM
  SHALL run the full hook chain (`validate` → `before_save` → write →
  `after_save`) and SHALL `INSERT` only mapped, writable columns.
- WHERE the PK column has a database default (identity, `gen_random_uuid()`),
  THE SYSTEM SHALL omit it from the `INSERT` and take the document `name` from
  `RETURNING`.
- WHERE the PK column has no default and the DocType declares an `autoname`, THE
  SYSTEM SHALL generate the name as it does for local DocTypes.
- WHEN a client updates a document, THE SYSTEM SHALL `UPDATE … WHERE <pk> = $1`
  writing only fields present in the payload and permitted at the user's
  permlevel.
- WHEN a client deletes a document, THE SYSTEM SHALL `DELETE` the row by PK,
  and SHALL first apply Featherbase's link-integrity check across **control-DB**
  DocTypes that link to it.
- IF the source rejects a write (not-null, check, unique, foreign key), THEN THE
  SYSTEM SHALL map the constraint to the owning field where it can and return a
  field-wise error, with the raw driver message only in the server log.
- THE SYSTEM SHALL never write a column the DocType does not map — a CLI-owned
  column absent from the DocType is left untouched by every update.

**Examples:**

| Before | Action | After |
|---|---|---|
| — | create `Control Tenant` slug `acme`, plan `pro` | Row inserted; `id` from `gen_random_uuid()` default returned as the document name |
| tenant `acme`, plan `pro`, `internal_notes` set by a CLI | Desk edits `plan` → `enterprise` | `plan` updated; `internal_notes` untouched |
| slug `acme` exists, unique index on `slug` | create another `acme` | `{"slug": "acme already exists"}`, 409-style error |

## EDS-7: Read-only sources and table allowlists

- WHERE a source is `read_only`, THE SYSTEM SHALL reject create, update, delete,
  submit and cancel on every DocType bound to it, and the Desk SHALL render its
  forms read-only.
- WHERE a source declares a table allowlist, THE SYSTEM SHALL refuse to bind or
  query any table outside it.
- THE SYSTEM SHALL surface a source's access mode on the DocType and in the Desk
  so the restriction is visible before a user starts typing.
- THE SYSTEM SHALL recommend, in the source's own help text, that a read-only
  source use a database role with `SELECT`-only grants — the application-level
  flag is a guard rail, not the security boundary.

**Examples:**

| Source access | Action | Result |
|---|---|---|
| `read_only` | open list | works |
| `read_only` | Save on a form | 403 "Data source railway-control is read-only"; Save button disabled |
| allowlist `control.tenant, control.deployment` | bind `control.secret` | rejected |

## EDS-8: Concurrency and conflict detection

- WHERE a `modified` column is mapped, THE SYSTEM SHALL detect conflicts exactly
  as it does locally: the update carries the loaded `modified` value in the
  `WHERE`, and zero affected rows is a conflict error.
- WHERE no `modified` column is mapped and the DocType opts into
  `conflict_check: row`, THE SYSTEM SHALL include every loaded mapped value in
  the `WHERE` clause, so a concurrent CLI write causes zero affected rows.
- WHERE no `modified` column is mapped and the DocType opts into
  `conflict_check: none`, THE SYSTEM SHALL update by PK alone (last write wins)
  and the Desk SHALL show a persistent notice on the form.
- IF a conflict is detected, THEN THE SYSTEM SHALL return the current row with
  the error so the client can show a diff.
- THE SYSTEM SHALL default a newly bound DocType to `row` when no `modified`
  column exists, never to `none`.

**Examples:**

| Before | Action | After |
|---|---|---|
| `updated_at` mapped; another writer bumped it | Save with stale `modified` | 409 conflict, current row returned |
| no timestamp column, `conflict_check: row`; a CLI changed `plan` since load | Save `slug` | 409 conflict, current row returned |
| `conflict_check: none` | Save | applied; form shows "Concurrent changes are not detected on this source" |

## EDS-9: Schema drift

- WHEN a bound DocType is loaded and the source's table has lost a mapped column
  or changed its type incompatibly, THE SYSTEM SHALL fail that DocType's
  requests with a clear drift error naming the column, and SHALL NOT silently
  drop the field.
- WHEN an administrator runs *Sync from source*, THE SYSTEM SHALL show added,
  removed and retyped columns and apply only the changes the administrator
  accepts.
- THE SYSTEM SHALL treat a column added on the source as informational — an
  unmapped column is not an error.
- THE SYSTEM SHALL cache a source's introspected shape alongside the meta cache
  and invalidate it on sync.

**Examples:**

| Change on the source | Result |
|---|---|
| CLI adds `control.tenant.region` | list still works; sync offers to add a `region` field |
| CLI drops `control.tenant.plan` (mapped) | requests for `Control Tenant` fail with "column plan no longer exists on railway-control/control.tenant"; sync offers to remove the field |
| `plan text` → `plan int` | drift error naming the type change |

## EDS-10: Featherbase companions on foreign records

- THE SYSTEM SHALL store comments, attachments, assignments, tags, versions,
  and share/permission rows for a bound document in the **control database**,
  keyed by `(doctype, name)`, exactly as for local documents.
- WHEN a bound document's `name` changes on the source (a PK the CLIs mutate),
  THE SYSTEM SHALL treat the old key's companion rows as orphaned and SHALL
  provide a reconcile report listing them.
- WHERE a local DocType has a `Link` field to a bound DocType, THE SYSTEM SHALL
  validate the link by querying the source.
- THE SYSTEM SHALL NOT offer link-integrity protection *on the source* — a CLI
  deleting a row cannot be blocked by Featherbase, so the reconcile report is
  the mechanism.
- WHERE a bound DocType has a `Link` field, THE SYSTEM SHALL allow it to target
  only DocTypes on the same source or in the control DB, validating each in its
  own database.

**Examples:**

| Input | Result |
|---|---|
| Comment on tenant `6f1c…` | Row in the control DB's comment table; visible on the form |
| CLI deletes tenant `6f1c…` | Form 404s; reconcile report lists 1 orphaned comment, 1 orphaned assignment |
| Local `Support Case.tenant` links to `Control Tenant` | Save validates the tenant exists by querying the source |

## EDS-11: Source failure and degradation

- IF a source is unreachable or times out, THEN THE SYSTEM SHALL return a
  `DataSourceError` naming the source, and SHALL NOT return an empty list as if
  there were no records.
- THE SYSTEM SHALL apply a per-source statement timeout and connect timeout, and
  SHALL bound its pool so a slow source cannot exhaust the server's workers.
- WHILE a source is failing, THE SYSTEM SHALL keep every control-DB DocType
  fully functional, and the Desk SHALL show the failure on the affected list and
  form only.
- THE SYSTEM SHALL log every foreign statement's duration and source name for
  diagnosis.

**Examples:**

| State | Action | Result |
|---|---|---|
| Railway unreachable | open `Control Tenant` list | error banner "railway-control is unreachable", retry button; sidebar and other DocTypes still work |
| Query exceeds `statement_timeout_ms` | list | timeout error, not a partial result |

## EDS-12: Transaction boundary

- THE SYSTEM SHALL execute a save that touches both databases as a control-DB
  transaction and a separate foreign statement, ordering the foreign write
  **last** so a failed foreign write leaves the control DB untouched by
  rollback.
- IF the foreign write succeeds and the control-DB commit then fails, THEN THE
  SYSTEM SHALL log a reconciliation record naming the doctype, name and
  operation, and surface it in the reconcile report.
- THE SYSTEM SHALL document at the API that a bound save is not atomic across
  databases, and SHALL NOT claim two-phase commit.
- WHERE a hook writes to the control DB and to the same source, THE SYSTEM SHALL
  keep all statements for one source inside one transaction on that source.

**Examples:**

| Scenario | Result |
|---|---|
| `validate` hook throws | nothing written anywhere |
| Foreign `INSERT` violates a check constraint | control-DB transaction rolled back; no version row, no comment |
| Foreign write ok, control-DB commit fails | reconciliation record written; report shows "Control Tenant/6f1c… inserted on source, local record missing" |

## EDS-13: Desk parity

- THE SYSTEM SHALL render a bound DocType with the same generic `ListView` and
  `FormView` as any other DocType — no per-source frontend code (invariant 3).
- WHEN a user opens a bound list or form, THE SYSTEM SHALL show a badge naming
  the source and its access mode.
- WHERE a source is read-only or a DocType has `conflict_check: none`, THE
  SYSTEM SHALL show that state on the form before the user edits.
- THE SYSTEM SHALL keep all UI within the existing `.fc-*` component classes and
  design tokens.

**Examples:**

| Input | Result |
|---|---|
| Open `Control Tenant` list | Standard list with filters and sorting; header badge "railway-control · read-write" |
| Read-only source | Badge "read-only"; Save/Delete absent, not merely disabled on click |

---

## Business Validation

- **BV1!:** Featherbase never issues DDL against a data source. (critical: the
  foreign schema belongs to someone else; a stray `ALTER` is unrecoverable.)
- **BV2!:** An update writes only mapped columns present in the payload.
  (critical: CLI-owned columns must survive Desk edits untouched.)
- **BV3:** A DocType is bound at creation or not at all; no conversion either way.
- **BV4:** A bound DocType with no mapped `docstatus` cannot be submittable.
- **BV5:** A bound DocType with no mapped `owner` cannot carry an `if_owner`
  DocPerm.
- **BV6:** A table without a single-column primary key cannot be bound.
- **BV7!:** Credentials are read from the environment at connect time and never
  persisted or echoed. (critical: a source's URL grants access to production
  data the Desk does not own.)

## Permissions

- **P1:** Permissions on bound DocTypes come from the same DocPerm/permlevel/
  role machinery as local DocTypes; there is no separate model.
- **P2:** Postgres RLS (PERM-004) covers control-DB tables only. Foreign rows
  are protected by the server layer alone — acceptable because clients never
  reach a database directly (invariant 2), but it must be stated, not assumed.
- **P3:** Only the System Manager role may create, edit or test a `Data Source`,
  or bind a DocType to one.
- **P4:** `if_owner` scoping requires a mapped `owner` column (see BV5).

## Input Validation

- **IV1:** Source name matches `^[a-z][a-z0-9-]*$`.
- **IV2:** Schema, table and column identifiers are validated against the
  introspected catalog and always emitted quoted — never string-interpolated
  from user input.
- **IV3:** `pool_max` between 1 and 20; `statement_timeout_ms` between 100 and
  60000.
- **IV4:** Every filter value is a bound parameter; operators come from the
  existing allowlist.

## State Rules

- **S1:** Saving a `Data Source` resets its status to `untested` and drops its
  pool, so the next request reconnects with current settings.
- **S2:** A successful *Sync from source* invalidates that DocType's meta cache
  and the source's introspection cache.
- **S3:** Flipping a source to `read_only` immediately blocks writes on every
  DocType bound to it, without a restart.

## Data Model

**T1: Data Source** (control DB)
- name (short identifier)
- engine (Postgres)
- url env var (name of the environment variable holding the connection string)
- default schema
- access (read-only | read-write)
- pool max (number)
- statement timeout ms (number)
- table allowlist (list, optional)
- status (untested | ok | error), last checked at, last error

**T2: DocType** — new fields
- data source (link to Data Source; empty means the control database)
- external schema, external table, external pk (column name)
- conflict check (modified | row | none)

**T3: DocField** — new field
- column name (defaults to the fieldname)

**T4: Reconciliation Log** (control DB)
- doctype, document name, operation, source, detected at, resolved (yes/no), detail

## What this requires of the foreign schema

The direct answer to "does this require any change to that schema?" — with the
control-schema case as the worked example.

| Featherbase capability | Needs a column? | If the column is absent |
|---|---|---|
| List, filter, sort, paginate | No | — |
| Open a record, edit, save | No — only a single-column PK | — |
| Create, delete | No | — |
| Comments, attachments, tags, assignments, versions | No — stored control-side | — |
| Roles, DocType and permlevel permissions | No | — |
| Audit line ("created / last modified") | `created_at`, `updated_at` (any names) | Line is blank |
| Optimistic locking | a `modified`-equivalent the **CLIs also update** | Falls back to whole-row comparison (EDS-8) |
| `if_owner` row scoping | an owner column holding a Featherbase user | `if_owner` perms rejected as misconfiguration |
| Submit / cancel workflow | a `docstatus` integer column | DocType cannot be submittable |
| Realtime push to open Desk views | a `LISTEN/NOTIFY` trigger, or polling | Views refresh on navigation only |

So: **a table with a single-column primary key can be managed as-is.** Every row
in the lower half is an opt-in enhancement, and each one degrades loudly rather
than silently.

## Verification (definition of done)

Unit tests alone do not count (session protocol step 5). To call this built:

1. A second Postgres — a `featherbase_external` database with a `control` schema
   created by a fixture script that mimics a CLI, *not* by a Featherbase
   migration — is bound as a source.
2. HTTP against the running server: list with filter+sort+paginate, get one,
   create, update, delete, and a rejected write on a read-only source.
3. A concurrent write applied directly to the foreign table (bypassing the
   server) produces a conflict error on the next save under both `modified` and
   `row` modes.
4. A column dropped directly on the foreign table produces the drift error, and
   *Sync from source* resolves it.
5. Playwright: the generic list and form render the bound DocType, the source
   badge shows, and a comment posted on a foreign record persists in the control
   DB.
6. The foreign database's schema is byte-identical before and after the run
   except for row data — proof of BV1.
7. `pnpm test` green with the second sandbox in place; typecheck clean.

## Out of Scope

- Joins spanning two databases, or reports over a mix of sources.
- Two-phase commit; any promise of cross-database atomicity.
- Writing to views, or to tables without a single-column primary key.
- Child tables (`istable`) stored on a source.
- Creating or migrating the foreign schema from Featherbase.
- Engines other than Postgres — see `docs/specs/0002-virtual-doctypes.md`.
- `postgres_fdw` as the transport (allowed later as an invisible optimisation).
