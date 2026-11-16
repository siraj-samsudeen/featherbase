---
name: connect-an-outside-database
description: Connect a client's existing database (Postgres, a DuckDB warehouse, a CSV folder) to Featherbase as a read-only Data Source and make its tables pleasant to browse — the password kept out of Featherbase, a table allowlist, readable Table names, personal columns left out, lookup tables connected so links appear, and multi-table questions answered with a client-app dataset. Use when asked to connect, browse, explore or report on an outside database in Featherbase, or when connected Tables show ids, generated names or refuse to connect.
---

# Connect an outside database

Featherbase reads a connected table **where it lives**: no copy is made, and
lists, filters and counts run against the source at that moment
(`openspec/specs/external-data-sources/spec.md`). This guide is the order that
works, and the traps met on the way. Steps marked *(changing)* name the issue
that will make them easier; update this guide when it lands.

## 1. Before connecting: can Featherbase reach it?

- Many vendor databases accept only whitelisted IP addresses. Check from the
  machine that will run the Featherbase server, with a read-only query
  (`select current_user`), before anything else. A local check proves nothing
  about a hosted server: Railway needs static outbound IPs, added to the
  vendor's whitelist by its DBA. That request is outward-facing: ask the owner
  first.
- Ask for, or use, a **read-only login**. Featherbase never writes through a
  read-only source, but a read-only login is the second lock.

## 2. Register the Data Source

Only a System Manager can. In the Admin UI: **Data Source → New**; or
`POST /api/table/Data%20Source`.

| Field | Set it to | Why |
|---|---|---|
| `engine` | `postgres`, `duckdb` or `csv-folder` | MySQL is not supported (ADR 0025) |
| `url_env` | the **name** of an environment variable holding the connection URL, e.g. `CLIENT_HR_URL` | The password is never stored, shown or logged. Each environment sets its own value. |
| `access` | `read_only` | Unless the owner asked for writes |
| `default_schema` | e.g. `public` | |
| `table_allowlist` | `schema.table` entries, comma-separated | The only tables that may be connected. **Write the schema**: a bare `store` never matches (#780, *changing*). |
| `statement_timeout_ms` | 30000 | A slow query is cancelled instead of loading the client's database |
| `pool_max` | 3 | Keep the load on someone else's database small |

Then **Test Connection** (`:test_connection`). A `CONNECT_TIMEOUT` from a
vendor database is often momentary: retry once before assuming a block.

**The server reads `url_env` from its own process environment at connect
time.** A server started without the variable cannot read the source, even
though the Data Source row is visible to it. On a shared local database,
another agent's server will show your connected Tables but fail to load them.
To work beside other agents, run your own server from your worktree on its own
port against the same database, with the variable added (README: one
instance's ports and `DATABASE_URL`).

## 3. Connect the tables

**Browse** (`:introspect`) lists each allowed table with a proposed name and
whether it can be connected. **Reflect** (`:reflect`) turns the chosen ones
into Featherbase Tables.

- **Choose the names.** The proposal is `<schema> <table words>`, so a Django
  table `store_store` becomes "Public Store Store". Pass
  `names: { "store_store": "Store" }` to `:reflect` (#783, *changing*: the
  Browse screen will offer it, #796). Name Tables the way the business speaks:
  Store, Floor, Employee, Deployment.
- **Connect the lookup tables too.** A column becomes a link only when the
  table it points at is connected. Connect designation, department, company,
  organisation and the like, or those columns stay bare numbers (#796 will
  hint at this). Order doesn't matter: links fill in whichever table arrives
  second.
- A table with no single-column key cannot be connected; the Browse screen
  says so.

## 4. Leave out what nobody should browse

Columns that look like secrets (passwords, API keys) are never connected. Personal
and tax data is **not** caught by that rule: date of birth, religion, phone,
social links, health-insurance numbers, PAN/TAN. Remove them right after
connecting: read the Table's meta (`GET /api/table/<Table>:meta`), then send
it back without those columns and with
`remove_columns: [...]` (`PUT /api/table_def/<Table>`). A removed column is
never read or written again. Prefer removing too much: add a column back only
when someone needs it.

## 5. Make the Tables readable

- **Title column.** Set each Table's `title_column` to what a person reads a
  row by (name, label, first name), so links show names, not ids.
- **List columns.** Pick four to six useful columns. A source's first columns
  are often the key and audit fields (created on, updated by).

Both are set by hand today (#796 makes reflect pick them; #792–#795 change how
names, filters, the relationship map and forms show).

## 6. Questions that cross many tables

Explore chains three Tables (#781). "Who works in this section" can cross five.
Answer such questions with a **dataset in the client's app**
(`client-apps/<client>/<app>/featherbase.json` → `datasets`, run read-only at
the source), never with a platform script report or code that names a client.
Reconcile a dataset against the client's own export, person by person, before
anyone relies on it.

## 7. The client's data never enters this repository

This repository is public. No client names, people, ids or exports in code,
tests, issues, PRs or screenshots. Tests use made-up rows (a "Shelf" titled
"Top"); screenshots for an issue come from made-up data.
