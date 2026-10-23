# Spec Delta

## MODIFIED Requirements

### Requirement: Everything that points at the table goes with it; mentions of it survive

Deletion SHALL sweep every real link to the table anywhere in the platform —
permissions, navigation links, and the like — in the same step as the table
itself. The table's history SHALL survive it: its change history, import
history, queued email and notifications keep naming the deleted table and can
still be read. A place that merely mentions the table's name in passing, such
as an activity log entry, is not a link and SHALL survive as a historical
record. History kept for a deleted table SHALL never act on a new table later
created under the same name.

#### Scenario: A log entry outlives the table it names

- **WHEN** an activity log line names a table that is later deleted
- **THEN** the line still reads the table's name after the deletion

#### Scenario: Deleting a Table keeps its history

- **WHEN** the user deletes a table whose rows were edited and imported
- **THEN** the change history and import history of those rows can still be
  read, naming the deleted table

#### Scenario: A new table with an old name starts clean

- **WHEN** the user re-creates a deleted table under the same name
- **THEN** the old table's imports cannot be reverted into it, and deleting
  the old import's tables leaves the new table alone
