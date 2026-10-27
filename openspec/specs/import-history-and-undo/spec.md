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

### Requirement: Every import leaves a record

Each real import SHALL be recorded with the file and sheet it came from, how
many rows were added, updated and refused, and the first few reasons rows were
refused. Checking a file before importing leaves no record.

#### Scenario: A run is recorded, a check is not

- **WHEN** the user checks a file, then imports it with one row refused
- **THEN** there is one record, showing the rows added, one refused and why
- **AND** the check on its own left nothing behind

### Requirement: The history shows only imports the viewer may see

The import history SHALL be shown only to people allowed to read import
records, and a person limited to their own records SHALL see only the
imports they ran.

#### Scenario: Someone without access

- **WHEN** a signed-in user with no permission to read import records asks for
  the import history
- **THEN** it is refused, and no file names, tables or counts are shown

#### Scenario: Someone limited to their own imports

- **WHEN** a user limited to their own records opens the history while
  someone else has also imported
- **THEN** only the imports that user ran are listed

### Requirement: Delete only the tables an import created

The user SHALL be able to delete every table an import created, in one
action; a table the import only added rows to is never deleted this way.

#### Scenario: Only the new tables go

- **WHEN** an import created three tables and added rows to a fourth table
  that already existed
- **THEN** deleting the import's tables removes the three it created
- **AND** the fourth table, with its rows, is untouched

#### Scenario: Only a System Manager can do it

- **WHEN** anyone other than a System Manager tries to delete an import's tables
- **THEN** it is refused and every table is kept

#### Scenario: A table something else depends on is kept

- **WHEN** one of an import's created tables is still linked to by another
  table
- **THEN** that one is kept, with the reason given, while the rest are
  deleted

### Requirement: Deleting an import's tables asks first

Before an import's tables are deleted, the user SHALL be shown which tables
will go and that their rows and import records go with them, and be able to
back out. Afterwards the outcome, including any table kept and why, is stated,
and the import is no longer listed once all its tables are gone.

#### Scenario: Named before anything is deleted

- **WHEN** the user chooses to delete the three tables an import created
- **THEN** the three tables are named and nothing is deleted until the user
  confirms
- **AND** afterwards the page says what was deleted

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

### Requirement: An undo can be rehearsed

The user SHALL be able to see what an undo would do, row by row, before it
changes anything.

#### Scenario: Look before undoing

- **WHEN** the user asks what undoing an import would do
- **THEN** the number of rows that would be restored, removed and left alone
  is shown, with the rows left alone named
- **AND** nothing is changed until the user undoes it for real

### Requirement: Undo says why it left a row alone

A row an undo does not touch SHALL be named with the reason: it was edited
since, it was deleted since, it was already gone, the import changed nothing
in it, or the table keeps no change history to restore from.

#### Scenario: Reasons are given

- **WHEN** an import is undone after one of its added rows was deleted by
  someone and one of its updated rows had not actually changed
- **THEN** each of those rows is listed as left alone, with its own reason
- **AND** the other rows are put back as usual

### Requirement: Undoing twice changes nothing more

Undoing an import that has already been undone SHALL change nothing and say
so, and the history marks the import as undone.

#### Scenario: A second undo

- **WHEN** the user undoes an import and then undoes it again
- **THEN** the second undo restores and removes nothing
- **AND** the history shows the import as undone

### Requirement: Undo needs the permission the changes need

An undo SHALL be refused as a whole, with nothing changed, when the user may
not make one of the changes it would make: restoring a row needs permission to
edit it, and removing an added row needs permission to delete it.

#### Scenario: Not allowed to delete

- **WHEN** a user who can edit but not delete rows tries to undo an import
  that added rows
- **THEN** the undo is refused and no row is changed
