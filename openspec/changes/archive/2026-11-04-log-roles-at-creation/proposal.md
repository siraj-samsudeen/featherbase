## Why

Granting or removing a role is recorded in a Person's history (#830). Roles given when the Person is created are not, so Activity never shows who gave the first roles. On 04-Nov-2026 the owner decided that creation records them too (#897).

## What Changes

- Creating a Person, or any tracked row whose access Sub-table rows are set at creation, records one history entry with those rows, for example "Roles: ∅ → Rh Clerk", marked as the creation entry. Activity reads it as "<who> created".
- A creation entry alone does not keep the row from being deleted, so a delete grant still removes a person with their roles. It is removed with the row. Any later history entry still refuses the delete (#321).

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: roles given at creation are recorded.

## Impact

- `apps/server/src/document.ts` (insert and delete), `apps/server/src/document-activity.ts`, `apps/web/src/components/ActivityTimeline.tsx`.
