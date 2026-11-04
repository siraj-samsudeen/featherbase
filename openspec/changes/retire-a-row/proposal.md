## Why

#859: people curating master data on staging (data-warehouse #4588) need to take a row out of use
without losing it. Delete is refused for any row with history, comments, attachments, shares or
rows linking to it (#321), and that rule stays: it protects the audit trail. So today a sample
plant mirrored from SAP, or a Business Unit superseded during setup, can only be left as it is,
offered in every list and picker. Each table designer would otherwise invent an "active" column
of their own.

## What Changes

- Every stored Table gets one standard way to **retire** a row and **reactivate** it, with a
  required reason. The platform records who retired it, when and why, on the row and in its
  history.
- Retired rows are left out of lists, pickers and Reference choices by default. A list can show
  them again, each marked as retired.
- An import that matches a retired row updates it and leaves it retired; the import preview
  counts those rows separately.
- When a delete is refused because the row has history or is linked from elsewhere, the refusal
  offers Retire as the way out.
- Retiring needs the same right as deleting on that Table; reactivating, the same as editing.
  The server enforces both.
- Existing Tables keep working unchanged; their own active flags (such as `is_active` on master
  tables loaded by the warehouse) are left alone.
- A System Manager can **delete a row permanently**, with its history, after a reason and a typed
  confirmation. Rows that still point at it are shown first, grouped by table, and are deleted too
  or unlinked; every removed row leaves a deletion record. Selected rows, or one import's rows, can
  go at once. Everyone else keeps today's rule (added by Siraj, 04-Nov-2026).
- Out of scope: retiring rows of sub-tables, Settings tables and Tables connected to an outside
  database.

## Capabilities

### New Capabilities

- `row-retirement`: retire and reactivate a row with a reason; retired rows leave lists, pickers
  and Reference choices; imports keep them retired; who, when and why show on the row and in its
  history.

### Modified Capabilities

- `row-deletion`: a delete refused because of history or links offers Retire instead; a System
  Manager can delete permanently, with a preview of dependent rows and a deletion record.

## Impact

- Server: three standard columns on every stored Table (`retired_at`, `retired_by`,
  `retired_reason`) with migration `0018_row_retirement.ts`; `:retire` and `:reactivate` row
  actions; the list, count, group-count, aggregate and summary reads; the import's dry run; the
  delete refusals; row capabilities and activity.
- Web: the form's Record actions, a retire dialog, a retired badge and line, the list's "show
  retired" toggle and row badge, the activity timeline, the delete dialog and the import preview.
