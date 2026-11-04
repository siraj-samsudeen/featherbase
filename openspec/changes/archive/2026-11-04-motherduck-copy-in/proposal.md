## Why

Business admins want to curate master data, such as a store list, inside Featherbase, while that
data already lives in a MotherDuck warehouse. Today only someone with server access can add a
MotherDuck source, the connection is slow and cannot see most of the warehouse, and a warehouse
table can only be viewed live, never copied in and corrected. This change lets a System Manager
do the whole job in the app (#772).

## What Changes

Part 1, built first:

- **Connect MotherDuck by pasting a token.** A guided page asks the kind, then the token, and
  tests it on the spot. The token is kept encrypted inside Featherbase and is never shown again.
- **Choose which databases a source reads.** The test lists every database the token can read;
  the System Manager ticks the ones to use. Featherbase opens only those, and never changes the
  MotherDuck account.
- **Browse a warehouse quickly.** The sidebar lists each source and its databases; the browser
  goes schema, then table, then a preview, reopens where each person left off, and keeps a
  database's table list instead of fetching it on every visit. A table with no declared key can
  be browsed.

Part 2, agreed on a mockup before it is built (#772, points 16–20):

- **Copy a warehouse table into an editable Featherbase table**, as one import that can be
  undone, and **copy it again** later, keeping people's corrections and raising a conflict when
  the source changes a corrected value. A row gone from the source shows as deleted at source.

## Capabilities

### New Capabilities

None. Part 2 may add one when it is agreed.

### Modified Capabilities

- `external-data-sources`: a MotherDuck source is connected by pasting its token in the app, its
  token is kept encrypted, it reads only the databases ticked for it, and its tables can be
  browsed side by side with the last place remembered. Today's promise that connection details
  are only ever named, never typed in, changes for MotherDuck tokens.

## Impact

- Server: the data source controller and registry, the DuckDB driver (single-attach MotherDuck
  connection, database listing), a new encrypted secret store, a per-database table-list cache.
- Web: a guided "Connect a data source" page on the Data Source table's New action, a Data
  sources sidebar group, a pane-based source browser replacing today's single list.
- Deployment: one new deployment variable, the master key that encrypts stored secrets.
- Supersedes, for MotherDuck tokens only, the rule that a secret stays a deployment variable
  (app-settings.ts); an ADR records it.
