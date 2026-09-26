## ADDED Requirements

### Requirement: A drifted or dropped column is caught, not silently lost

WHEN a connected table's other end has dropped or retyped a column the table
maps, Featherbase SHALL fail that table's requests with a clear message
naming the column, rather than quietly dropping the field or returning wrong
data. A builder SHALL be able to see what changed on the other end — added,
removed or retyped columns — and choose which of those changes to bring in.

#### Scenario: A mapped column disappears

- **WHEN** the other end drops a column a connected table maps, and someone
  opens that table
- **THEN** Featherbase says the column no longer exists there, instead of
  showing the table as if nothing were wrong

### Requirement: A row's Featherbase additions survive when the source deletes or renames it

WHEN a connected row that carries comments, files or other Featherbase-side
additions disappears or changes its id at the source, Featherbase SHALL keep
a record of those orphaned additions and let a builder review them, rather
than losing track of them silently.

#### Scenario: The source deletes a row with a comment on it

- **WHEN** something outside Featherbase deletes a connected row that has a
  comment attached
- **THEN** the comment isn't lost — it shows up in a review list of
  additions whose row is gone

### Requirement: Stricter conflict-catching without a last-changed time

WHERE a connected table's source has no last-changed time to check, a
builder SHALL be able to turn on stricter conflict-catching, so a save is
compared against every value that was loaded rather than skipped; while it's
off, Featherbase SHALL show a plain notice on the table that concurrent
changes aren't being caught.

#### Scenario: Turning on stricter checking

- **WHEN** a builder turns on stricter conflict-catching for a connected
  table with no last-changed column
- **THEN** a save that no longer matches every value it loaded is refused,
  the same as it would be if a last-changed time existed
