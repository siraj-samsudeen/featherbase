## Why

Since per-operation permissions (#917), unticking a grant in the permission matrix deletes its Permission row. A grant that was ever edited has history, so the delete is refused and the person keeps the access (#1034). Clearing the old flag was an update, which history never blocked.

## What Changes

- Unticking a grant in the matrix ends the access whatever is on the row. Its history, comments, attachments and shares stay.
- The grant's history gains one last entry saying who ended it and what it was, so the record still answers who revoked what once the row is gone.
- The matrix's other refusals stay: the last tick of a creator-only or app-owned grant, and a grant another depends on.
- Every other delete keeps its rules, for a Permission row as for any row.

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: taking a grant away in the matrix keeps its history.

## Impact

- `apps/server/src/document.ts`, `apps/server/src/index.ts`. No migration.
