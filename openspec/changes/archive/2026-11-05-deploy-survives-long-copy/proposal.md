## Why

A deploy on staging failed because a Copy again kept the apps busy past the deploy's one 60-second wait. The person deploying then has to notice and deploy again, and every copy refresh makes that more likely, because a refresh that finds nothing new still rewrites every row. The owner approved the fix on 05-Nov-2026 (#971).

## What Changes

- A deploy keeps trying by itself for about ten minutes, in short attempts with a pause between, saying what it is doing. If it still cannot start it fails as it does today, with nothing changed.
- A copy, manual or scheduled, reads the warehouse without keeping the apps busy. It takes the apps' lifecycle lock only to apply the rows, and refuses if the app that owns the Table was upgraded meanwhile.
- A refresh leaves a row that has not changed alone: it is not rewritten, and its last-updated time does not move. Its history, corrections and conflicts stay as they are.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `running-an-instance`: a deploy waits out long work by itself.
- `external-data-sources`: a copy's read does not hold up a deploy; a refresh leaves unchanged rows alone.

## Impact

- Server: the app lifecycle lock, the request middleware, the job runner, copy and import code. No schema change, no app manifest change.
- Docs: `docs/DEPLOY.md`.
