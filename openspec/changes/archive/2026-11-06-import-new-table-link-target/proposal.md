## Why

Importing a file as a new Table offers Reference as a column type but never asks which Table it links to, so the new Table can't get a working link (#1014).

## What Changes

- Choosing Reference shows a Table picker on that row, offering only Tables the person can read.
- Import waits until a Table is picked, and says so.
- Check is offered on a new Table with a link column, and reports each file value that matches no row of the target.

## Capabilities

### Modified Capabilities

- `spreadsheet-import`: setting a new Table's link target, and checking its values.

## Impact

- `apps/web/src/pages/ImportWizard.tsx`, and a type in `packages/shared`. No server, schema or app version change.
