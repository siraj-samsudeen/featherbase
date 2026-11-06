## Why

A `PUT /api/table_def/<name>` that sends only `columns` blanks `title_column` and `description`, because the server treats a missing setting as empty (#1025).

## What Changes

- An update changes only what it names. Settings left out stay, and an explicit empty value clears one.
- Columns may be left out too, so a setting can be changed on its own.
- A new title column must be a value column of the Table.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: what an update to a Table's definition changes.

## Impact

- `apps/server/src/table-engine.ts`. No schema or app version change. Every UI save already sends the whole definition, so none relied on the blanking.
