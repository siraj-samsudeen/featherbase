# Proposal

## Why

Two connected-table faults found in the overnight audit (#535, #518). A Featherbase table with a link to a connected table could not save any row: the save failed with a server error instead of checking the linked row on its data source. And asking to connect several tables from a data source, where a later one is not on the source's list of allowed tables, connected the earlier ones before refusing, leaving a half-finished setup behind a refusal.

## What Changes

- Saving a row that links to a connected table checks that the linked row exists on the data source. It saves when it does and gives the usual "does not exist" message when it does not.
- When several tables are asked for at once, every one is checked against the data source's list of allowed tables before any is connected. One refused table refuses the whole request and connects none.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: links from a Featherbase table to a connected table; the allowed-tables list refuses a mixed request outright.

## Impact

`apps/server/src/document.ts` (link check on save) and `apps/server/src/sources/reflect.ts` (connect request). No migration, no new setting.
