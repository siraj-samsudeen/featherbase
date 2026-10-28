## Why

People's private uploads must not be claimed by another file record, and simultaneous approvals must not repeat an action. Address rotation within one IPv6 network must not reset sign-in limits.

## What Changes

- Refuse assigning stored file paths outside uploads or replacing them on edits.
- Count IPv6 sign-in attempts by network while preserving full audit addresses.
- Serialize workflow decisions on the current row.
- Prove existing activity parent locks serialize with rename and delete (#599).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `files-and-sharing`: only uploads may claim stored content (#680).
- `sign-in-and-accounts`: IPv6 network budgets (#575).
- `workflow-and-approvals`: concurrent actions have one winner (#572).

## Impact

Server file saves, upload handling, pre-auth admission and workflow actions. Independent-connection tests use disposable local databases. No schema migration, permission redesign or shared-instance writes.
