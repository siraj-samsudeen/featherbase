# Import History and Undo

## Purpose

Every import is something the user can look back on as one thing they did,
however many sheets or tables it touched, and take back if it turns out to
be wrong. This covers the history and the undo mechanics shared by every
import; undoing a Table Merge uses the same history and undo, since a merge
is itself a kind of import.

## Requirements

### Requirement: One import is one entry, however many tables it touched

The import history SHALL show one entry per import, however many sheets or
tables it touched, saying which tables it created and which it only added
rows to.

#### Scenario: Eleven sheets read as one import

- **WHEN** a workbook of eleven sheets becomes eleven tables in a single
  import
- **THEN** the history shows one entry naming all eleven, not eleven
  separate entries

### Requirement: Delete only the tables an import created

The user SHALL be able to delete every table an import created, in one
action; a table the import only added rows to is never deleted this way.

#### Scenario: Only the new tables go

- **WHEN** an import created three tables and added rows to a fourth table
  that already existed
- **THEN** deleting the import's tables removes the three it created
- **AND** the fourth table, with its rows, is untouched

#### Scenario: A table something else depends on is kept

- **WHEN** one of an import's created tables is still linked to by another
  table
- **THEN** that one is kept, with the reason given, while the rest are
  deleted

### Requirement: An import can be undone

The user SHALL be able to undo an import: rows it added are removed, and
rows it updated get their prior values back.

#### Scenario: Undo restores an updated row

- **WHEN** an import updated a row, and the import is undone
- **THEN** the row's values return to what they were before the import

#### Scenario: Undo removes an added row

- **WHEN** an import added a row, and the import is undone
- **THEN** that row is removed

### Requirement: Undo skips what changed since, unless told otherwise

Undoing an import SHALL leave alone any row someone has changed since the
import ran, naming it as skipped rather than overwriting a later edit; the
user can choose to undo it anyway, as a separate, explicit step.

#### Scenario: A later edit is protected by default

- **WHEN** a row an import updated has since been edited by someone else,
  and the import is undone
- **THEN** that row is left as it is and named as skipped

#### Scenario: The user overrides the skip on purpose

- **WHEN** the user chooses to undo a skipped row anyway
- **THEN** that row is put back the way the import left it, and the later
  edit is lost
