# Proposal

## Why

Two go-live bugs leave records out of step with what the user sees. Re-importing a corrected file adds duplicate rows when a value already in the table has a stray space around it (#517). Deleting the tables of an installed app one by one leaves the app recorded as installed with none of its tables, so installing it again is refused (#122).

## What Changes

- A file row's match value and the table's stored value are both compared without the spaces around them, so a stored "A1 " is updated by a file's "A1".
- A table an installed app owns can't be deleted on its own. The refusal names the app and says to uninstall it, which removes the app's tables together.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spreadsheet-import`: spaces around a stored match value no longer stop a match.
- `table-deletion`: a table that belongs to an installed app is refused, naming the app.

## Impact

Server only: the import's match lookup and its key index (migration 0130 drops the indexes built on the untrimmed value), and table deletion.
