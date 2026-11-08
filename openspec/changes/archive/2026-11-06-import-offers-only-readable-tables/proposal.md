## Why

Import Data looks up every Table to offer as a target. An app's mandatory access can refuse a Table even to a System Manager who lacks the app's role, and that one refusal stopped the whole wizard, including for a new Table (#1007).

## What Changes

- A Table the person can't read is left out of the import targets, and the rest still load.
- Any other failure, such as an outage, still stops the wizard and says so. It never reads as "no such Table".

## Capabilities

### Modified Capabilities

- `spreadsheet-import`: which Tables are offered as targets.

## Impact

- `apps/web/src/pages/ImportWizard.tsx` only. No server, schema or app version change.
