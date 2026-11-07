## Why

A Table's title column, the name people see for its rows, can only be changed through the API (#1024).

## What Changes

- The Columns page has a Title choice: one radio per column that can name a row, saved at once, with a way to clear it.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: choosing a Table's title column.

## Impact

- `apps/web/src/pages/ColumnEditor.tsx`, and a set exported from `packages/shared`. It saves through a PUT naming only `title_column` (#1025). No schema or app version change.
