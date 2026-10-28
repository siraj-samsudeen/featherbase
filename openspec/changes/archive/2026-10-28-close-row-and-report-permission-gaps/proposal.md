# Proposal

## Why

The go-live review of the row-access fixes (#338, #341, #342) found four more gaps. A file attached to a row could be listed by anyone with a broad grant on files, even without access to the row. A comment could be deleted by its id on a row the person cannot open. A role allowed to create rows but not edit them saved every new row blank, because the save kept only the columns the edit grant allowed. And someone who may edit a saved report could widen what a scheduled email sends, since the email runs with the scheduler's access.

## What Changes

- A file attached to a row is listed, opened and removed only by someone who can open that row, like its comments. A file attached to a whole table, or to nothing, still follows the grant on files.
- A comment, or a file, on a row is removed only by someone who can open that row.
- A new row keeps the columns its creator typed when their role may create rows, even if it may not edit them.
- A report that a scheduled email sends can be changed only by the person who set up every schedule that sends it, or by a System Manager.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `files-and-sharing`: files on a row follow the row's access.
- `comments-and-history`: deleting a comment needs access to its row.
- `permissions-and-roles`: a create grant reaches the columns of a new row.
- `reports-and-charts`: a scheduled report's definition is guarded like its schedule.

## Impact

Server list scoping of row-attached rows, the delete path, the insert path's column tiers, and a new Report validation hook. No schema change and no migration.
