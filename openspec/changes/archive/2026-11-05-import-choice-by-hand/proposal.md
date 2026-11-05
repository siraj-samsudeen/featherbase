## Why

Demoing Excel import on staging, a column of many values switched to Choice by hand failed with "Invalid Table definition" and nothing to act on (#990). The wizard sent no options for it and hid the server's reason. The same paths had two more dead ends: rows refused on a one-sheet import disappeared behind a jump to the list, and trying again after a dropped connection said the Table already exists.

## What Changes

- Switching a column to Choice takes its options from the sheets feeding it, however many there are. A long list shows the first eight and how many more.
- A value with spaces around it imports as its option.
- A refused Table says why, naming the column.
- A one-sheet import with refused rows stays on the wizard.
- Trying again after a dropped connection works if no row landed, and refuses with the way out if some did.

## Capabilities

### Modified Capabilities

- `spreadsheet-import`: a Choice picked by hand, refusals that say why, refused rows that stay on screen, and trying again after a dropped connection.

## Impact

- `packages/shared/src/import.ts` and `apps/web`: the import wizard, and the refusal wording it now shares with the Table builder. No server or schema change.
