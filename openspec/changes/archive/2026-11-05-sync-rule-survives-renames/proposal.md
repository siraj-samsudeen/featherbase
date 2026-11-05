## Why

A master sync rule (#927) names its master Table, its Source Link Table and their columns, and the copied table's columns. Renaming any of them through the ordinary rename left the old name in the stored rule, and the next sync failed until a System Manager set the rule again (#936). Renaming the master Table or a synced column would also have raised every open difference a second time, because a difference is recognised by those names.

## What Changes

- Renaming the master Table, the Source Link Table, or a column the rule names (on the master, the link Table or the copied table) carries the new name into the rule, in the rename's own transaction.
- The last values seen per row, and the differences already raised, follow a renamed master column, so nothing is raised twice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `master-data-sync`: a rule keeps working when a Table or column it names is renamed.
