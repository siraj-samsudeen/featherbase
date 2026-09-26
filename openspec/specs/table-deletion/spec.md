# Table Deletion

## Purpose

Deleting a table takes it away completely — not hidden, not recoverable —
along with everything that only existed because the table did, while
leaving what's outside the table's own reach untouched.

## Requirements

### Requirement: Only the builder authority can delete a table, and confirmation names the cost

Deleting a table SHALL require System Manager authority, the same authority
creating one requires; a refusal never removes anything partially. Before
anything is destroyed, the builder SHALL see a confirmation naming the table
and its exact current row count, and saying the action cannot be undone.

#### Scenario: Confirmation names the table and its row count

- **WHEN** a manager asks to delete a table holding eight rows
- **THEN** the confirmation names the table, says eight rows will be
  permanently deleted, and says this cannot be undone

#### Scenario: Cancelling leaves everything as it was

- **WHEN** the confirmation is dismissed instead of confirmed
- **THEN** the table, its rows and everything tied to it are untouched

### Requirement: Deleting a table removes what creating it built

Deleting a table SHALL remove its definition, its rows, their nested
repeating rows and the files attached to them, all at once. A nested-rows
table that other tables also use keeps its own definition; only this table's
rows in it go, and a stored file another row still uses is kept.

#### Scenario: A table with nested repeating rows

- **WHEN** a table with a nested repeating-rows column and eight rows is
  deleted
- **THEN** the table, its rows and their nested rows are gone, and the
  nested rows' own table definition remains for other tables that use it

### Requirement: A table other tables depend on can't be deleted until they're changed

If any other table links to this one, or stores its own repeating rows in
it, deletion SHALL be refused, naming every table and column that depends on
it — even where that other table currently holds no rows, because the
dependency is the link itself, not the data. A table linking only to itself
SHALL NOT be blocked by that link. A table the platform itself depends on
SHALL be refused outright, with no way around it.

#### Scenario: The refusal names what's blocking it

- **WHEN** deletion of a table is refused because another table links to it
- **THEN** the refusal names that other table and column, and nothing about
  either table changes

#### Scenario: Unblock and retry
- **WHEN** the blocking link is removed and deletion is retried
- **THEN** it completes the same way an unblocked deletion always does

### Requirement: Everything that points at the table goes with it; mentions of it survive

Deletion SHALL sweep every real link to the table anywhere in the platform —
permissions, import history, navigation links, and the like — in the same
step as the table itself. A place that merely mentions the table's name in
passing, such as an activity log entry, is not a link and SHALL survive as a
historical record.

#### Scenario: A log entry outlives the table it names

- **WHEN** an activity log line names a table that is later deleted
- **THEN** the line still reads the table's name after the deletion

### Requirement: Row numbering is never reset or reused by deletion

Deleting a table SHALL NOT reset or reuse its row-numbering. Building a new
table under the same name later SHALL continue numbering from wherever that
counter already stands, never repeating a number a deleted row once held.

#### Scenario: Numbering continues after a rebuild

- **WHEN** a table's rows were numbered 1 through 8, the table is deleted,
  and a table of the same name is built again
- **THEN** its first new row is numbered 9, not 1

### Requirement: Deleting a connected table only drops the connection

A table connected to an outside data source SHALL, on deletion, drop only
that local connection. Nothing is changed at the source, and deletion
succeeds even if the source can't currently be reached.

#### Scenario: The source is untouched

- **WHEN** a table connected to an external file is deleted
- **THEN** the connection is gone, and the external file is exactly as it
  was

### Requirement: A deleted table's old address remembers why it's gone

Asking for a table that has been deleted SHALL answer with the deletion
itself — who deleted it and when — instead of a bare error or an empty
page, wherever that table would normally be reached: a saved link, a recent
item, or its own address. A name that was never used SHALL still get a plain
"not found," never a fabricated deletion.

#### Scenario: An old link explains itself

- **WHEN** a table deleted yesterday is reached through a saved link
- **THEN** the page says who deleted it and when, rather than showing an
  error or an empty list
