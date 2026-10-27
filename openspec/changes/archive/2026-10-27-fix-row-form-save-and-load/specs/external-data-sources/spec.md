## MODIFIED Requirements

### Requirement: Concurrent edits are caught when the source can tell

WHEN a connected table's rows carry a last-changed time, saving a row SHALL
check it hasn't changed there since it was loaded, and refuse the save if it
has. Without a last-changed time to check, a save simply overwrites whatever
is there, and a row open for editing SHALL say so.

#### Scenario: No last-changed time, no check

- **WHEN** a connected table has no last-changed time and a person saves a row
  that was changed at the data source after it was loaded
- **THEN** the save goes through and replaces what is there

#### Scenario: The form warns that saves aren't checked

- **WHEN** the user opens a row of a connected table that has no last-changed
  time and can be edited
- **THEN** the form tells them, for as long as the row is open, that changes
  made at the data source meanwhile won't be noticed and saving replaces them

#### Scenario: Someone else changed the row first

- **WHEN** a person saves a row after something else has changed it at the
  data source since it was loaded
- **THEN** the save is refused, and the user can reload the row to see what
  changed
