# StyleHR (warehouse)

The same thirteen StyleHR tables as `../stylehr/`, read from the warehouse copy
of the HR system in MotherDuck (`bronze_stylehr`) instead of the HR database.
Use it where the HR database can't be reached, such as a hosted server whose
addresses StyleHR's database does not accept. An instance installs this app or
`stylehr`, never both: they make the same Tables.

`app.json` is the whole app. Its `reflect.tables` entries are identical to
`stylehr`'s, except that each also leaves out the warehouse loader's
bookkeeping columns (`_dlt_load_id`, `_dlt_id`); a server test checks it. The
data source differs: engine
`duckdb`, schema `bronze_stylehr.public`, variable `STYLEHR_WAREHOUSE_URL`. The
warehouse declares no keys or links, so the entries' `key` and `links` (#876)
make each row addressable by its id and link the tables as the HR database does.

## What differs from the live app

- **Age:** as old as the warehouse's last StyleHR load, not live.
- **Deleted rows stay:** StyleHR deletes rows outright, and the warehouse copy
  keeps some of them (on 03-Nov-2026 about 600 more employees than the HR
  system had). Don't count people from it.
- Everything else (names, left-out personal and tax columns, titles, lists,
  links) is the same.

## Setting it up on an instance

1. Set `STYLEHR_WAREHOUSE_URL` in the server's environment to
   `md:?motherduck_token=<token>`, using a **read-only** MotherDuck token of an
   account that has the `bronze_stylehr` share attached. It is never written in
   this repository; each environment sets its own.
2. As a System Manager, install the manifest:

   ```bash
   jq '{manifest: .}' client-apps/jeyarama/stylehr-warehouse/app.json |
     curl -sS -X POST "$FEATHERBASE/api/install_app" \
       -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @-
   ```

3. Uninstalling (`POST /api/uninstall_app {"name": "stylehr-warehouse"}`)
   removes the thirteen tables and the data source.
