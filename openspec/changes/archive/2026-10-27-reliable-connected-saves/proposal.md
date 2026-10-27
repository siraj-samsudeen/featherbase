# Proposal

## Why

On a table connected to a MySQL database, a save could hand back another program's change as if it were the user's own, or say a row it had just saved was missing, when something else wrote to the same row at that moment (#155). A new row the database numbers in its own way could be written and then lost track of. And when the database refused a save, for a missing value, a link to a row that doesn't exist or a broken rule, the user saw the database's own error text instead of a plain message on the field (#154).

## What Changes

- A save on a connected table hands back the row exactly as that save left it. A new row without an id is refused before anything is written when the data source numbers rows in a way Featherbase can't read back.
- The check for "changed since you loaded it" compares whole thousandths of a second, the same way for every kind of database, so a change a fraction of a millisecond away is no longer missed.
- When a data source refuses a save, the user gets a plain message on the field it concerns where it can tell which one. The data source's own text goes only to the server log.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: a save hands back what it saved; a refused save says why in plain words.

## Impact

The MySQL data-source driver and the connected-table save path in the server. No migration, no new setting.
