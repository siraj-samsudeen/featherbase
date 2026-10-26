# Proposal

## Why

An import check reported a bad row only as "Invalid values for <Table>" (#416). With a dozen columns, nobody could tell which cell to fix, although the server already knew the column and the reason.

## What Changes

- A refused row's problem names each refused column, by the header the file uses for it, and why.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spreadsheet-import`: the check names the column and the reason for each problem.

## Impact

`apps/web/src/lib/import-run.ts` and the import wizard's calls to it. No API change: the server already returns the per-column reasons.
