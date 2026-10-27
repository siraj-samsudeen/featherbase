# Proposal

## Why

An app could only ever grow by one optional column at the end of a table, so
its first version had to declare every table it might one day need (#651, the
owner's first requirement). Real apps change shape as they learn: they add and
remove tables, add, change, rename and remove columns. An upgrade now can, and
the people who run an instance see what an upgrade would remove before it runs.

## What Changes

- An app's new version can add and remove its own tables; add a column of any
  kind at a chosen place; change a column's label, choices, whether it is
  required or unique, its default and whether it is hidden; change its kind
  where every value carries over; rename a column or a table; and remove a
  column.
- Renames keep the rows, their history, the links to them and who may see them.
- Removing data must be declared in the app's version. Before it runs, the
  upgrade's preview, the release check and the rehearsal on a copy of the
  instance each say how many rows or values that instance would lose, never
  the values themselves.
- Installing a version directly and upgrading to it step by step give exactly
  the same tables.
- A table an upgrade adds arrives with the access its version declares. Access
  to the tables the app already had still never widens through an upgrade.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: an upgrade can reshape the app's own tables, with
  data-removing steps declared and counted per instance first.

## Impact

The upgrade runs every change through the same table engine an administrator's
edits use. The table engine gains two operations an administrator does not get:
renaming one of an app's tables, and a safe change of a column's kind. No
platform migration is needed.
