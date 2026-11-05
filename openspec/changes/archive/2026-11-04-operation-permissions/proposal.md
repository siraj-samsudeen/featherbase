# Permissions per operation, with the columns each one reaches

Issue: [#917](https://github.com/siraj-samsudeen/featherbase/issues/917), piece A of the
split of [#683](https://github.com/siraj-samsudeen/featherbase/pull/683) (#462). The owner
approved the split, and kept platform administrators' access to app data, on 04-Nov-2026.

## Why

Store managers need to maintain some details of their own records and not others
(#462). Today a grant is one row of on/off switches for a whole role, and a column is
either "basic" or "restricted", so "may read the employee number but change only the
phone" cannot be said. Scoped administration, held approvals and app-upgrade grants
(pieces B, C and E) all need a grant that names one operation and the columns it
reaches. This change lays that foundation without changing who can do what today.

## What Changes

- A grant names **one operation** (read, create, update, delete, submit, cancel, amend,
  or reading a person's identifiers), whether it covers every row or only the rows the
  person created, and **which columns** it reaches: every basic-level column, every
  column, or only the columns listed.
- Every existing grant converts to grants that reach exactly what it reached before,
  including columns added later and line items. Installed apps keep their grants and
  their recorded ownership of them.
- A change to a column the person may not change is **refused**, and nothing in that
  change is saved. Before, the forbidden part was quietly dropped and the rest saved.
- Apps released before this change keep loading and upgrading unchanged: their
  on/off grant declarations are read as basic-level grants. New app versions may name
  operations and columns directly.
- The grant matrix screen keeps working for basic-level grants; finer grants are
  edited as individual permission rows.

Not in this change: scoped administration and delegation (B), held approvals (C), the
Platform Admin rename (D, which keeps administrators' access to app data), and app
upgrades that add or widen grants (E).

## Capabilities

### Modified Capabilities

- `permissions-and-roles`: a grant reaches columns per operation; an ungranted change
  is refused instead of dropped.

## Impact

- Platform schema: migration `0142_operation_permissions` rewrites every Permission row.
  It must be rehearsed on a restored snapshot before a live instance takes it
  (`docs/DEPLOY.md`).
- Server permission checks, the app manifest permission contract, the grant matrix
  endpoint, token reach and the Apps page's grant summary.
- No app version changes: Tasker, Tickets and Feather Dash ship unchanged.
