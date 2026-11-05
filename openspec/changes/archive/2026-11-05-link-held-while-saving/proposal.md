## Why

A save checks that each row it links to exists, and a delete checks that nothing links to the row it removes. When the two ran at the same moment, both checks could pass: the delete removed the row and the save then committed a link to nothing (#947). Only links into an app's Tables were safe.

## What Changes

- A save holds every row it links to until it commits. A delete or a rename of that row waits for the save, then sees the link and refuses.
- A save that keeps its row's id no longer makes saves that link to that row wait. Only deletes and renames wait (Siraj, option C).

## Capabilities

### Modified Capabilities

- `row-deletion`: a row still linked from elsewhere can't be deleted, even by a delete racing the save that links to it.

## Impact

- Row locks in the save path. A committed-database proof (`LINK_LOCK_COMMIT_PROOF`) runs in CI beside the other committed proofs.
