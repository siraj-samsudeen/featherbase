## Why

Retiring a Permission row marked it retired, but the holder kept the access (#1060), and a refused delete of a grant advised retiring it. Retiring never changes who may see what, so a retired grant that stopped granting would break that promise; a retired grant that keeps granting misleads. A grant already has one way to end that keeps its history: unticking it in the permission matrix (#1034).

## What Changes

- Permission rows cannot be retired. Retiring one is refused, saying to untick it in the permission matrix; the row offers no Retire.
- A refused delete of a grant says to untick it in the permission matrix, and no longer offers Retire.
- Grants marked retired before this change are unmarked. They always kept granting, so nobody's access changes; the history entry of each retirement stays.

## Capabilities

### Modified Capabilities

- `row-retirement`: the Permission table does not offer retiring.
- `row-deletion`: a refused delete of a grant points at the permission matrix.

## Impact

- `packages/shared/src/row-retirement.ts`, `apps/server/src/document.ts`, `apps/server/src/document-activity.ts`.
- Migration `0156_permission_not_retired.sql` clears retirement marks on Permission rows.
