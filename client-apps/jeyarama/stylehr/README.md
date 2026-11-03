# StyleHR

Browse JeyaRama's HR system (StyleHR) live inside Featherbase: its stores, floors,
sections, employees, deployments, designations, departments, organisations and
firms. Featherbase reads the HR database where it lives, through a read-only
login, and stores none of its rows.

`app.json` is the whole app: a manifest with no code. It declares one Postgres
data source, `stylehr`, and connects thirteen tables in the **StyleHR** module,
each with its name, its key and links, its title column, its list columns and the
columns left out. The key and links agree with the HR database's own; they are
there so `stylehr-warehouse/`, which reads the warehouse copy, can use the very
same table entries. Change one app's entries, copy them to the other.
Personal and tax columns (date of birth, religion, social links, health insurance
number, PAN, TAN and the like) are left out, so no instance can read or show them.

## Setting it up on an instance

1. Set `STYLEHR_URL` in the server's environment to a read-only login's
   connection string (`postgres://user:password@host:port/database`). It is
   never written in this repository; each environment sets its own. StyleHR
   accepts only whitelisted IP addresses, so check from the server's machine
   first.
2. As a System Manager, install the manifest:

   ```bash
   jq '{manifest: .}' client-apps/jeyarama/stylehr/app.json |
     curl -sS -X POST "$FEATHERBASE/api/install_app" \
       -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d @-
   ```

   Install connects to StyleHR, so the server must reach it; a `CONNECT_TIMEOUT`
   is often momentary, so retry. An install that fails connects nothing.
3. Uninstalling (`POST /api/uninstall_app {"name": "stylehr"}`) removes the
   thirteen tables and the data source.

## Changing it

- A column the HR system adds later is connected at the next install unless
  `leave_out_columns` names it: review new columns before reinstalling.
- A column named in the manifest that the table lacks stops the install, and the
  error names it. Fix the manifest.
- Table and column names are fine in this public repository (owner,
  03-Nov-2026); a person's data, an export or a screenshot of real data is not.
