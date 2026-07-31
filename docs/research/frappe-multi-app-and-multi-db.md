# Frappe: many apps in one instance, and what it does about other databases

Research note, 2026-07-26. Written to answer four questions before speccing the
Featherbase equivalent:

1. How does Frappe support multiple apps in one instance?
2. Do apps share one database? One schema, or a schema each?
3. Can one app talk to a remote Postgres while others use the local one?
4. What does Frappe do when the data already exists in someone else's schema,
   maintained by something other than Frappe?

Short answers: **apps share one database and one schema per site**; app
boundaries are metadata only; a *site* can live on a remote database server but
an *app* cannot; and the only supported way to sit on top of foreign data is the
**Virtual DocType** protocol, which trades away every SQL-level feature of the
framework.

## The three units: bench, app, site

- **Bench** — a directory holding `apps/` (one git repo per app), `sites/` (one
  directory per site), one Python virtualenv, and the shared Redis/worker/
  scheduler processes. Installing an app with `bench get-app` installs it into
  the virtualenv, so its *code* is available to every site on the bench.
- **App** — a Python package with `hooks.py`, `modules.txt`, and a folder per
  module containing DocType JSON. Scaffolded by `bench new-app`.
- **Site** — one database plus `sites/<site>/site_config.json` plus that site's
  files. Requests are routed to a site by `Host` header.

Code availability and installation are separate steps: `bench --site x
install-app y` runs the app's install hooks against site `x`, creates its
DocType tables there, and records the app in the `Installed Application` child
table. So one bench, N apps in the venv, M sites, and each site picks its own
subset of the N.

## Do apps share a database? Yes — one database per *site*, not per app

Every app installed on a site writes into the **same database and the same
schema**. There is no schema-per-app and no schema-per-site: on Postgres, Frappe
uses the default `public` schema, and site isolation comes from using a separate
*database* (usually with its own DB user).

Consequences worth internalising:

- **The table namespace is flat and global.** Every DocType becomes
  `tab<DocType Name>`, so DocType names must be unique across *all* installed
  apps. This is why real apps prefix: `HD Ticket` (Helpdesk), `CRM Lead`.
- **App ownership is metadata, not physics.** `DocType.module` links to
  `Module Def`, and `Module Def.app_name` names the owning app. Uninstalling an
  app finds its tables by walking modules. Nothing at the storage layer knows
  which app a row belongs to.
- **Cross-app joins, links and transactions are free**, precisely because there
  is no boundary. This is the main reason the flat namespace survives: an
  ERPNext Sales Invoice can `Link` to an HR Employee with no plumbing.

## Can one app use a remote Postgres while others use local? Not at the app level

The database connection is resolved **per site, per request**, into the
thread-local `frappe.db`. The keys come from `site_config.json` (which overrides
`common_site_config.json`): `db_type`, `db_host`, `db_port`, `db_name`,
`db_user`, `db_password`.

So: site A can sit on a managed remote Postgres while site B on the same bench
sits on a local one. But *within* a site, every app shares one connection, and
the framework offers no per-app or per-DocType routing.

The escape hatches, in increasing order of framework integration:

1. **`frappe.database.get_db(socket=None, host=None, user=None, password=None,
   port=None, cur_db_name=None)`** — an ad-hoc second connection to an arbitrary
   host. This is a raw handle: you write the SQL, you manage the lifetime.
   Nothing about the document engine, permissions, or the Desk applies. Note
   that `setup_database()`/`bootstrap_database()` deliberately do *not* accept
   this — DDL is only ever aimed at the site's own database.
2. **Virtual DocType** (`is_virtual = 1`) — a DocType with no `tab` table whose
   controller supplies the storage. `frappe/model/virtual_doctype.py`
   `validate_controller()` enforces the protocol: instance methods
   `load_from_db`, `db_insert`, `db_update`, `delete` must be *overridden*, and
   `get_list`, `get_count`, `get_stats` must exist as **staticmethods**. In
   return, the REST resource API, the Desk list and form views, and roles and
   permissions all work unchanged; the docs state the source "can be anything: an
   external API, a secondary database, JSON or CSV files".
3. **Product-level connectors** — Frappe Insights and Data Migration keep
   external connections as first-class documents, but those are read/ETL paths,
   not the document engine.

**What the Virtual DocType route costs.** The framework stops being able to
generate SQL for you, so the controller must implement filtering, sorting and
pagination itself. `frappe.db.*` helpers return nothing for virtual data
("database APIs will not return virtual values since they don't live in the Site
Database"), the report builder and joins don't apply, and virtual child rows are
in-memory only — the parent never persists them. GitHub issue #17282 tracks a
long tail of CRUD/display bugs in exactly this area.

**And there is no way to bind a normal DocType to a pre-existing table.**
Frappe's table name is derived from the DocType name (`tab<Name>`) with no
override, and its engine assumes its own standard columns (`name`, `owner`,
`creation`, `modified`, `modified_by`, `docstatus`, `idx`). Sitting on top of a
schema that some other tool created and keeps writing to is, in Frappe, either a
Virtual DocType or a data migration. There is no third option.

## What this means for Featherbase

| Concern | Frappe | Featherbase today | Verdict |
|---|---|---|---|
| App code registry | Python package in the bench venv, `hooks.py` | `AppManifest` registered in-process (`apps/server/src/apps.ts`) | parity |
| Installed-app record | `Installed Application` child table | `tab_installed_app` (name + owned doctypes) | parity |
| Site | one database + `site_config.json` | one Postgres **schema** + `tab_site` registry (`tenancy.ts`) | divergent but defensible |
| Apps sharing storage | one DB, one schema, flat `tab*` namespace | one DB, one schema, flat `tab_*` namespace | parity |
| App → owning module | `Module Def.app_name` | `tab_installed_app.doctypes` | parity |
| Per-site remote DB | `db_host` in `site_config.json` | none — one `config.databaseUrl` pool in `db.ts` | **gap** |
| Second/arbitrary connection | `frappe.database.get_db(...)` | none | **gap** |
| DocType over a foreign store | Virtual DocType protocol | none (no `is_virtual`) | **gap** |
| DocType over an *existing table* | impossible | impossible (`tableName()` derives the name) | **gap, and an opportunity** |

The last row is where Featherbase can beat the original rather than copy it.
Frappe has to be conservative because it supports MariaDB and Postgres and runs
its own DDL. Featherbase targets Postgres only, already routes 100% of reads and
writes through the server (invariant 2), and already generates its SQL from
metadata — so binding a DocType to `{connection, schema, table}` with a
column-to-fieldname map is a *smaller* change here than it would be there, and
it preserves list views, filters, sorting and pagination as real SQL instead of
handing them to a controller.

Both mechanisms are specified:

- `docs/specs/0001-external-data-sources.md` — connections plus DocTypes bound
  to existing Postgres tables (the SQL-native path).
- `docs/specs/0002-virtual-doctypes.md` — the controller protocol for sources
  that are not Postgres tables (the escape hatch, mirroring Frappe).
- `docs/adr/0007-app-and-database-topology.md` — why apps still share one
  control database, and why binding is per-DocType rather than per-app.

## Sources

- [Frappe: Virtual DocTypes](https://docs.frappe.io/framework/v14/user/en/basics/doctypes/virtual-doctype)
- [`frappe/model/virtual_doctype.py`](https://github.com/frappe/frappe/blob/develop/frappe/model/virtual_doctype.py) — the enforced controller protocol
- [`frappe/database/__init__.py`](https://github.com/frappe/frappe/blob/develop/frappe/database/__init__.py) — `get_db()` and `setup_database()`
- [`frappe/core/doctype/module_def/module_def.json`](https://github.com/frappe/frappe/blob/develop/frappe/core/doctype/module_def/module_def.json) — `app_name` on `Module Def`
- [Frappe: site configuration](https://docs.frappe.io/framework/v14/user/en/basics/site_config) — `db_name`, `db_host`, `db_password`; site vs common config
- [Frappe: deployment configuration options](https://www.mintlify.com/frappe/frappe/deployment/configuration)
- [frappe/frappe#17282 — virtual doctype CRUD/display issues](https://github.com/frappe/frappe/issues/17282)
