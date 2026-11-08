## Why

Renaming a row named after its own column moves its ID and leaves the column on the old value, so a link that reads that column still shows the old ID (#1029).

## What Changes

- A rename updates the source column in the same transaction, and takes a prefix off a prefixed ID.
- The column's rules judge the new value: its type, choices, uniqueness, link target and data scope. A read-only column refuses the rename.

## Capabilities

### Modified Capabilities

- `naming-and-numbering`: what a rename changes.

## Impact

- `apps/server/src/document.ts`. No schema or app version change.
