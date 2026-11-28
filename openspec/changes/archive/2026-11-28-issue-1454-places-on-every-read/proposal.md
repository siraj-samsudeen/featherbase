## Why

Siraj, 28-Nov-2026: the filter belongs on the Table itself. Applied only inside an app's own reads, it left the
ordinary read paths (the Table read, record pages, MCP, exports) unable to show these Tables to anyone but an
administrator, and the app had to route every read through a read of its own.

## What Changes

- A Table about places (a read-only copy by its dataset's filters; an app's own Table by `scopedTables`) is read only
  within each person's places on every read path: lists, counts and charts, a single row, writes, a Sub-table's
  rows, and live updates. A row the person wrote is always theirs. A System Manager is not narrowed, as with Data
  Scope.
- **Removed:** validators reading their app's copies as the app; the app-read-only scoped reader.

## Impact

`apps/server/src/place-scope.ts` (new), `query.ts`, `document.ts`, `realtime.ts`, `runtime-packages.ts`, `shared`.
