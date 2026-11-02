## Why

A script report opens with empty filters even when its author supplied starting values. People get an unfiltered first answer instead of the report they were promised (#778).

## What Changes

- Fill the existing controls from declared defaults before the automatic first run, including zero and false.
- Keep explicit edits and cleared values for subsequent runs. Opening another report starts from that report's defaults.
- Keep the existing controls, routes and server execution contract; no redesign or server-side default injection.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `reports-and-charts`: start a script report with its declared filters, without overriding later choices.

## Impact

The script-report page and its real-server web tests. No database migration, dependencies or permission changes.
