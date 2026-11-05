## Why

While a client reshapes its master data, old tables are replaced by new ones (#905: Jeyarama's Operating Site, Business
Unit, Business Unit Plant and Business Unit Division give way to Site Master, Plant and new Business Unit rows). The old
tables will be deleted eventually, but during the move people still open them as a reference. A table can only be live
or deleted today, so the workaround (an "Archive" module, a "RETIRED" description, write roles removed) hides nothing and
does not stop administrators or service accounts from writing.

## What Changes

- A System Manager can archive a table, noting what replaced it, and un-archive it later. Deleting stays a separate step.
- An archived table's rows and history stay readable by whoever could read them, but nobody can add, change, delete,
  import or merge its rows, through the screens or the API.
- An archived table leaves the module menus, the command bar and the table pickers, and is listed under "Archived" on
  All tables. Its list and its rows carry a banner saying it is archived, by whom, when, and what replaced it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a table can be archived and un-archived.
