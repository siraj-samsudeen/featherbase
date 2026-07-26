# Frappe: Multiple Apps, One Instance — and External Databases

> **Provenance:** research session, 2026-07-26. Sources: the Frappe
> architecture study already in this repo
> (`docs/research/frappe-architecture.md`, from a v17.0.0-dev clone), Frappe
> documentation and forum threads (linked at the end), and a full sweep of the
> Featherbase codebase on the same date. Written to answer four concrete
> questions and to ground the requirements spec at
> `docs/specs/external-database-doctypes.md`. Research only — no code changed.

The four questions this answers:

1. How does Frappe support multiple apps in one instance?
2. Do those apps share the same database — same schema or different schemas?
3. Can one app use a remote Postgres while others use a local one?
4. Can you put a Frappe(-like) management app *on top of* an existing schema
   that is already being populated by other tools (CLIs), without changing
   that schema — is it transparent?

---

## 1. How Frappe supports multiple apps in one instance

Frappe has a three-level structure:

- **Bench** — one installation: a Python virtualenv, a set of app checkouts,
  Redis, workers, and a `sites/` directory. `bench` is the CLI that manages
  it.
- **App** — a Python package on the bench (`frappe`, `erpnext`, `hrms`, your
  custom app). An app is a *code* artifact: DocType definitions as JSON files
  on disk, controller classes, a `hooks.py` declaring doc_events, scheduler
  jobs, overrides, fixtures. Apps have no storage of their own.
- **Site** — one *tenant*: a directory under `sites/` with a
  `site_config.json` naming exactly one database (`db_name`, `db_host`,
  `db_password`, `db_type`). A bench serves many sites; requests are routed
  to a site by host name (DNS multi-tenancy) or port.

"Multiple apps in one instance" means **installing several apps onto the same
site**. `bench --site mysite install-app erpnext` runs the app's sync: every
DocType JSON the app ships is inserted into the site's `tabDocType` /
`tabDocField` metadata tables, and a physical table `tab<DocType Name>` is
created for each one — *in that site's single database*. The app's hooks are
aggregated at boot (`frappe.get_hooks()` merges every installed app's
`hooks.py`), so any app can listen to any DocType's lifecycle events,
including wildcard `"*"` hooks.

Because everything lands in one database, cross-app integration is trivial
and is the whole point: ERPNext links to `tabUser` (from frappe), HR links to
`tabEmployee`, one permission system and one events bus span all apps.

### Where Featherbase already mirrors this

Featherbase has the same shape, minus the filesystem packaging:
`apps/server/src/apps.ts` (PLAT-001/002) — an `AppManifest` (name, doctypes,
doc_events, scheduler_events, method overrides), `installApp` runs each
declared DocType through the normal engine, `tab_installed_app` is the
install ledger, and hooks coexist with core controllers. All of it targets
the one shared database, exactly like Frappe.

## 2. Same DB, different schemas? No — same DB, *same* namespace

This is the part most people guess wrong. Apps installed on a site do **not**
get their own schema. All tables from all apps live flat in the site's one
database:

- On **MariaDB** (Frappe's default), "database" and "schema" are the same
  thing; every `tab*` table from every app sits side by side in the site DB.
- On the **Postgres backend**, everything goes into the default schema
  (`public`). Frappe never issues `CREATE SCHEMA` per app.

The `module` field on a DocType — the thing that looks like a namespace — is
an organizational label (it decides which app's folder the JSON lives in and
how the Desk sidebar groups things). It has zero effect on storage,
naming, or connections. Table names are globally unique per site
(`tab<DocType>`), so two apps cannot both define a `Customer` DocType.

**The isolation boundary in Frappe is the *site*, never the app.** One site =
one database = one shared namespace for all its apps. Two sites on the same
bench share code but have fully separate databases.

(Featherbase again mirrors this: `module` is a sidebar label
(`DeskLayout.tsx`), tables are `tab_<name>` in `public`, and its multi-tenancy
(PLAT-008, `tenancy.ts`) is schema-per-*site* within the one Postgres —
sites are isolated by `search_path`, apps are not isolated at all.)

## 3. Can one app use a remote Postgres while others use a local one?

**Not natively.** A site has exactly one database connection, declared in
`site_config.json`. There is no per-app or per-DocType connection setting
anywhere in the framework; every ORM call, query builder call, and report
runs on that single connection. (The whole site's DB can be remote — e.g. a
managed Postgres — but it is still *one* DB for all apps.)

The sanctioned escape hatch is the **Virtual DocType**:

- A DocType flagged `is_virtual = 1` gets **no table** in the site database.
- Its controller class implements the data protocol itself:
  `db_insert`, `load_from_db`, `db_update`, `delete` (instance methods), and
  `get_list`, `get_count`, `get_stats` (statics).
- The data source can be anything — a second/remote database, a REST API,
  CSV/JSON files. Frappe's own engineering blog demonstrates MongoDB-backed
  DocTypes this way.
- To the Desk UI and the `/api/resource` REST surface, a virtual DocType is
  indistinguishable from a normal one: list view, form view, filters, and
  permissions all work, because they go through the same Document/Meta layer.

So the honest Frappe answer to "app A on Railway PG, app B on local PG" is:
app B's DocTypes are normal; app A's DocTypes are all virtual, and app A
ships controller code that opens its own connection to the remote Postgres
and maps rows ⇄ documents. It works, it is used in production, but it is
**hand-written glue per DocType**, and framework features that assume a local
table degrade: no automatic DDL/migrations for the external store, no SQL
reports over those tables, no cross-DB joins/link-field queries, backups
don't cover the external data.

## 4. Putting a management app on top of an existing, live schema

The scenario: a "control schema" in a Railway-hosted Postgres, with real
tables and real data being written continuously by CLIs. Can Frappe (or
Featherbase) sit on top as a management UI?

**Does the existing schema need to change? No.** The Virtual DocType route
requires *zero* changes to the external schema. Frappe never runs DDL against
the external store, never adds columns, and doesn't demand its `tab` naming
or standard columns (`name`, `creation`, `modified`, `owner`, `docstatus`, …)
there — those conventions apply only to tables Frappe itself creates. The
CLIs keep writing exactly as before; the framework is just another client of
that database.

**Is it "immediately transparent — I can just put it on top"? Not in Frappe.**
Two gaps stand between "point it at my schema" and a working Desk:

1. **No reflection.** Frappe cannot generate DocType metadata from an
   existing table (`information_schema` → DocFields). This is a
   long-standing community ask with no built-in answer; people write one-off
   scripts. You must define the DocType (fields, types, labels) yourself so
   it mirrors the table.
2. **No declarative external connection.** The virtual DocType controller is
   Python you write: open the connection, implement the six protocol
   methods, map the external primary key to Frappe's `name`, fake
   `modified`/`creation` if the table lacks timestamps. One controller per
   DocType (though a shared base class per external DB is the usual
   pattern).

Once that glue exists, it *is* transparent in the ways that matter: the
generic UI, REST API, permissions, and hooks all treat the external rows as
ordinary documents, and CLI-written rows appear in the Desk on the next read
because nothing is copied or cached — every read goes to the source.

One operational caveat for shared-writer tables: Frappe's optimistic-lock
("document has been modified") protection leans on a `modified` timestamp.
If the external table has an updated-at column, the controller can honor it;
if not, concurrent CLI/Desk writes can silently last-write-win.

## 5. Featherbase today: none of this exists yet

Verified against the codebase on 2026-07-26:

- **One connection string, everywhere.** `config.databaseUrl` is a scalar
  (`apps/server/src/config.ts`); the `sql` export in `db.ts` is a module-level
  singleton imported by ~40 modules. The only other production `postgres()`
  call is `tenancy.ts`, which dials the *same* database with a different
  `search_path`. No connection registry, no FDW, no dblink.
- **No virtual/external DocType concept.** `doctypeDefSchema`
  (`doctype-engine.ts`) has no `is_virtual`, no table-name override, no
  connection field. `createTableDDL` unconditionally emits
  `create table "tab_x"` (not even `IF NOT EXISTS` — a pre-existing table
  fails with raw PG `42P07`), and every generated table gets the standard
  columns. Nothing can map a DocType onto a table the engine didn't create.
- **Schema sync is metadata-diff only.** `updateDocType` compares old vs new
  DocField rows; it never inspects `information_schema` — so there is no
  reflection primitive to build on yet either.
- **Apps share the one DB by construction.** `installApp` calls the same
  `createDocType`; an app cannot bring its own connection.
- No harness feature, ADR, or roadmap item covers multi-database or external
  data sources (checked `harness/features.json`, `docs/adr/*`,
  `docs/ROADMAP.md`, `PROGRESS.md`).

**Conclusion:** the requirement — a management app over the Railway control
schema, alongside apps on the local Postgres — is not supported in
Featherbase today, and in Frappe it is supported only via hand-coded Virtual
DocTypes. Featherbase can do one better than Frappe here precisely because it
is metadata-driven end-to-end: make the external mapping *declarative*
(connection registry + table adoption by reflection) instead of per-DocType
controller code. That is what the spec proposes:
**`docs/specs/external-database-doctypes.md`**.

---

## Sources

- `docs/research/frappe-architecture.md` (this repo) — §4 "External data
  sources → Virtual DocTypes", virtual DocType protocol, `tabSingles`,
  per-DocType `CREATE TABLE` behavior.
- [Frappe docs — Sites (multitenancy, one DB per site)](https://docs.frappe.io/framework/v15/user/en/basics/sites)
- [Frappe docs — Virtual DocTypes](https://docs.frappe.io/framework/v14/user/en/basics/doctypes/virtual-doctype)
- [Frappe blog — MongoDB-powered DocTypes](https://frappe.io/blog/engineering/mongodb-powered-doctypes)
- [Frappe forum — "Generating DocType from existing database?"](https://discuss.frappe.io/t/are-there-any-possibilities-of-generating-doctype-from-existing-database/94340)
- [Frappe forum — "How to pull and store data in external database"](https://discuss.frappe.io/t/how-to-pull-and-store-data-in-external-database/101264)
- [Frappe forum — "Using external cloud PostgreSQL instance"](https://discuss.frappe.io/t/using-external-cloud-postgresql-instance/140590)
- [frappe/frappe — `frappe/model/virtual_doctype.py`](https://github.com/frappe/frappe/blob/develop/frappe/model/virtual_doctype.py)
