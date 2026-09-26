# Spreadsheet Import

## Purpose

Bring rows from a CSV or Excel file into a table that already exists,
choosing where each file column goes, fixing what needs fixing, and deciding
whether rows land as new or update rows already there. Building a brand-new
table from a dropped file is covered by Tables and Fields; folding one
existing table's rows into another is covered by Table Merge.

## Requirements

### Requirement: Import a file into an existing table

Importing a file SHALL pair its columns with an existing table's columns
automatically wherever the names clearly match, leaving the rest for the
user to pair by hand. When the table itself is chosen automatically because
the file matches it well, that choice is said in words before anything is
sent, rather than used silently.

#### Scenario: A close match is named, not assumed

- **WHEN** a file whose columns closely match an existing table is dropped
- **THEN** that table is offered as the destination, named on screen, before
  any rows are sent
- **AND** the user can pick a different table instead

### Requirement: A workbook's sheets are chosen one at a time

Dropping a file with several sheets SHALL first show what the file
contains — sheet by sheet, with any hidden ones named as hidden — with
nothing selected until the user says so, so a sheet nobody picked never
becomes a table.

#### Scenario: Nothing is imported until sheets are picked

- **WHEN** a workbook with several sheets is dropped
- **THEN** no sheet is selected yet, and the count of tables the current
  selection would make is shown
- **AND** a sheet the user never selects creates nothing

### Requirement: Several sheets of the same shape become one table

The user SHALL be able to send several sheets of the same shape into one
table instead of one each. Columns that are obviously the same column,
however they're spelled, are folded together for the user; a column only
some of the sheets carry is kept, naming the sheets that lack it. Two
column names that don't obviously match are never guessed together — the
user says so, shown real values from each to help decide.

#### Scenario: Matching spellings fold; unlike names don't

- **WHEN** three sheets spell one column differently but obviously the same
  way, and two others use names that look nothing alike for what is really
  the same thing
- **THEN** the obviously-same spellings become one column automatically
- **AND** the unlike names stay separate until the user says they're the
  same thing

### Requirement: Add new rows or update the ones that match

The user SHALL be able to choose a column to match file rows against the
table's existing rows: a match updates that row, and a file row matching
nothing is added instead, with both counts shown before anything commits.
An update only changes columns the file maps, and the user chooses, for
each import, whether a mapped cell left blank clears the matched row's
existing value there or leaves it as is.

#### Scenario: Re-importing a corrected file updates instead of duplicating

- **WHEN** a file already imported is corrected and re-imported with the
  same matching column chosen
- **THEN** the changed rows update in place
- **AND** the table's row count does not change

#### Scenario: A blank cell keeps the existing value by default

- **WHEN** a mapped cell is left blank in the file and the user hasn't
  chosen to clear blanks
- **THEN** the matched row keeps whatever value it already had there

### Requirement: The file's own codes can become the row ids

Mapping a file column onto the table's row-identity column SHALL make that
column's values the imported rows' ids directly, instead of generating new
ones. Rows the file doesn't supply an id for still get one however the
table normally identifies new rows.

#### Scenario: A file's reference codes become the ids

- **WHEN** a file column carrying the user's own reference codes is mapped
  onto the row-identity column
- **THEN** the imported rows take those codes as their ids

### Requirement: A large update is confirmed before it runs

An import about to update more than a small number of rows SHALL ask the
user to type that exact count back before it proceeds, so a wrong matching
column is never clicked past by accident.

#### Scenario: The count must be typed back

- **WHEN** an import would update more rows than the confirmation point
- **THEN** the user must type the exact number back before the import runs
- **AND** a missing or wrong number leaves the import blocked

### Requirement: A problem with one part doesn't stop the rest

Importing several targets in one run SHALL attempt every target even after
one is refused, reporting what imported, what failed and why, and what is
left — never stopping silently at the first problem. A row that fails to
import is named by the row number the user would see in their own
spreadsheet, counting any blank rows above it.

#### Scenario: The rest continue after one target fails

- **WHEN** a workbook has three targets and the second is refused
- **THEN** the first and third still import
- **AND** the second is named as failed, with its reason

#### Scenario: A failed row is found where the user expects it

- **WHEN** a bad value sits several blank rows into a file
- **THEN** the failure names that row the way it appears in the user's own
  spreadsheet, not its position among only the good rows

### Requirement: Leaving the import screen doesn't lose the work

Leaving the import screen and coming back, including a full reload, SHALL
restore the file, every choice made so far and any results already
committed. Returning after an import has fully finished instead starts
fresh, ready for the next one.

#### Scenario: Come back mid-import

- **WHEN** the user imports one of several targets, leaves to look at the
  rows it created, and comes back
- **THEN** the file, the remaining choices, and the already-imported result
  are still there

#### Scenario: A finished import doesn't come back

- **WHEN** a full import has finished and the user returns to the import
  screen later
- **THEN** a fresh screen is ready for the next import

### Requirement: Check for problems before committing

The user SHALL be able to check a target's rows for problems before
importing it for real, seeing the same row-by-row outcome a real run would
report, with nothing written until the user imports for real.

#### Scenario: Rehearse before importing

- **WHEN** the user checks a target before importing it
- **THEN** it reports the same passes and problems a real import would
- **AND** nothing is written until the user imports for real
