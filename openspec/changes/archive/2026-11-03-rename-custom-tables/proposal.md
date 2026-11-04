## Why

The owner settled a naming rule on staging: a table people own and correct is
named for the business thing ("Plant"), and only an untouched copy keeps a
source prefix ("SAP Plant") (#871). The existing custom Table "SAP Plant" could
not be renamed. The workaround was a new Table, copied rows, re-applied
corrections and re-pointed links, which lost the edit history, and a
re-imported correction stopped counting as a person's edit (#865).

## What Changes

- A System Manager renames a custom Table from its list, with **Rename Table**,
  or through `POST /api/table_def/:name/rename` with `{ to }`.
- One transaction carries everything that names the Table:
  - its rows, storage and numbering;
  - history, comments, files, tags and shares;
  - permissions and data scopes;
  - Reference columns in other Tables;
  - saved views, list settings, the glossary, recently opened entries;
  - the import memory that keeps people's edits on a re-import.
- The old name and its address answer "renamed to <new name> by <who> on
  <date>", and the Admin links to the Table under its new name. Before release
  there are no aliases (AGENTS.md, Project stage).
- Platform Tables, app Tables, Tables bound to a data source and settings
  Tables are not renamed here.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: renaming a custom Table.

## Impact

`renameTable` in `table-engine.ts`, which an app's upgrade uses (#651), is
split: a shared `moveTable` holds the sweep, and the new `renameCustomTable` is
the Admin entry point. The sweep gains the import memory tables and the
recently opened entries. `getMeta` and `resolveTableName` read the rename
testimony from the Access Log, as they already do for a deleted Table. No
migration.
