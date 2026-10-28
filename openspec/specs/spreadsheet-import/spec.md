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

### Requirement: A file that isn't a spreadsheet is refused

Dropping something that is not a CSV or Excel file SHALL be refused with a
message naming the file, and nothing is started.

#### Scenario: A text file is turned away

- **WHEN** the user drops a plain text file onto the import screen
- **THEN** a message says it is not a CSV or Excel file
- **AND** no import is set up

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

### Requirement: A column can be left out

The user SHALL be able to leave any file column out of the import; a column
left out is never read into the table.

#### Scenario: Leave a column out

- **WHEN** the user switches off one of the file's columns before importing
- **THEN** the imported rows have nothing in that column

### Requirement: Dates keep the day the sheet shows

A date typed in a spreadsheet SHALL be imported as the same calendar day the
sheet shows, whatever time zone the user's computer is in.

#### Scenario: A date doesn't slip a day

- **WHEN** a workbook cell shows 15 January 2026 and is imported from a
  computer in India
- **THEN** the imported row holds 15 January 2026, not the day before

### Requirement: Codes keep every digit

A value that is really a code, such as 007 or a 16-digit reference
number, SHALL be imported exactly as written, with its leading zeros and every
digit, rather than being turned into a smaller number.

#### Scenario: A code with leading zeros survives

- **WHEN** a file column holding the code 007 and a 16-digit reference number
  is imported
- **THEN** the imported rows hold 007 and every digit of the reference number,
  not 7 or a rounded figure

### Requirement: Importing needs permission to add or change rows

An import SHALL be refused as a whole, with nothing written, when the user
may not add the rows it would add or change the rows it would change. A check
before importing needs the same permission.

#### Scenario: A user who can't add rows is turned away

- **WHEN** a user without permission to add rows to a table tries to import a
  file into it, or only to check it
- **THEN** the request is refused and no row is written

### Requirement: Add new rows or update the ones that match

The user SHALL be able to choose a column to match file rows against the
table's existing rows: a match updates that row, a file row matching
nothing is added instead, and a row with nothing in any mapped column is
counted and skipped rather than silently mismatched — all three counts
shown before anything commits. An update only changes columns the file
maps, and the user chooses, for each import, whether a mapped cell left
blank clears the matched row's existing value there or leaves it as is.

#### Scenario: Re-importing a corrected file updates instead of duplicating

- **WHEN** a file already imported is corrected and re-imported with the
  same matching column chosen
- **THEN** the changed rows update in place
- **AND** the table's row count does not change

#### Scenario: A blank cell keeps the existing value by default

- **WHEN** a mapped cell is left blank in the file and the user hasn't
  chosen to clear blanks
- **THEN** the matched row keeps whatever value it already had there

#### Scenario: Rows with nothing to import are skipped, not guessed at

- **WHEN** a file has rows with no value in any mapped column
- **THEN** those rows are counted separately and skipped
- **AND** the counts still add up to the file's total rows

#### Scenario: Spaces around a stored value don't stop a match

- **WHEN** a row already in the table holds "A1 " with a trailing space, and
  a file matched on that column carries "A1"
- **THEN** the re-import updates that row instead of adding a second one

### Requirement: An unclear match is refused, never guessed

When a file row's match value appears on more than one file row, or matches
more than one existing row, or is blank, every row involved SHALL be refused
with the reason, instead of picking one to update.

#### Scenario: A repeated or doubled value

- **WHEN** the same match value appears twice in the file, or one value matches
  two rows already in the table
- **THEN** each of those file rows is reported as refused, saying why
- **AND** the rest of the file is not held up

### Requirement: The matching column is remembered

Re-importing into a table that was matched with a column before SHALL
suggest that same column again, named for the user to confirm or change —
never applied silently.

#### Scenario: The same matching column is suggested next time

- **WHEN** a table was last imported into using one column as the match,
  and the user imports into it again
- **THEN** that column is offered as the suggested match, named on screen
- **AND** the import doesn't use it until the user confirms or changes it

### Requirement: The file's own codes can become the row ids

Every table gives each new row an id automatically; mapping a file column
onto that id column instead SHALL make its values the imported rows' ids
directly. Rows the file doesn't supply an id for still get one however the
table normally identifies new rows.

#### Scenario: A file's reference codes become the ids

- **WHEN** a file column carrying the user's own reference codes is mapped
  onto the row-identity column
- **THEN** the imported rows take those codes as their ids

#### Scenario: A matched row keeps its id

- **WHEN** the user matches on another column while the file also carries an
  id that differs from the matched row's
- **THEN** that file row is refused, saying an update can't change a row's id

### Requirement: A large update is confirmed before it runs

An import about to update more than a small number of rows SHALL ask the
user to type that exact count back before it proceeds, so a wrong matching
column is never clicked past by accident.

#### Scenario: The count must be typed back

- **WHEN** an import would update more rows than the confirmation point
- **THEN** the user must type the exact number back before the import runs
- **AND** a missing or wrong number leaves the import blocked

### Requirement: A large file is imported in parts

A file with many rows SHALL be sent in parts and still read as one import:
the totals add up across the parts, and rows matched against the table see
the rows earlier parts added.

#### Scenario: Parts add up

- **WHEN** a file big enough to be sent in several parts is imported
- **THEN** the added, updated and failed counts across the parts add up to the
  file's rows
- **AND** a later part matching on a value an earlier part added updates that
  row instead of adding it again

### Requirement: A bad row doesn't stop the others

A row that fails to import SHALL not stop the other rows in the same
import — they still land — and the failed row is named by the row number
the user would see in their own spreadsheet, counting any blank rows above
it.

#### Scenario: A failed row is found where the user expects it

- **WHEN** a bad value sits several blank rows into a file
- **THEN** the other rows still import
- **AND** the failure names that row the way it appears in the user's own
  spreadsheet, not its position among only the good rows

### Requirement: Several targets in one run don't stop each other

Importing several targets in one run SHALL attempt every target even after
one is refused, reporting what imported, what failed and why, and what is
left — never stopping silently at the first problem.

#### Scenario: The rest continue after one target fails

- **WHEN** a workbook has three targets and the second is refused
- **THEN** the first and third still import
- **AND** the second is named as failed, with its reason

### Requirement: Sheets can be imported one at a time or all together

With several sheets chosen, the user SHALL be able to work through them one
step at a time, importing each on its own, or import everything still waiting
in one go. A sheet already imported is never imported again by either route,
and its result stays readable while the next sheet is worked on. Once any
sheet has been imported, the choice of sheets is fixed for the rest of that
import.

#### Scenario: One now, the rest later

- **WHEN** the user imports the first of three sheets on its own and then
  chooses to import the rest
- **THEN** the second and third are imported and the first is not imported
  again

#### Scenario: The sheet choice is fixed once one is imported

- **WHEN** the user has imported one of two chosen sheets
- **THEN** the user can no longer go back to change which sheets are chosen,
  and is told why
- **AND** can still step between the two sheets

### Requirement: Leaving the import screen doesn't lose the work

Leaving the import screen and coming back, including a full reload, SHALL
restore the file, every choice made so far and any results already
committed — except that a workbook too large for the browser to hold keeps
only the choices, and the user is told before leaving and asked to drop the
file again on return. A different file dropped then never replaces the saved
work without the user saying so. Returning after an import has fully finished
instead starts fresh, ready for the next one.

#### Scenario: Come back mid-import

- **WHEN** the user imports one of several targets, leaves to look at the
  rows it created, and comes back
- **THEN** the file, the remaining choices, and the already-imported result
  are still there

#### Scenario: A file too big to keep still keeps the choices

- **WHEN** a workbook too large for the browser to hold is dropped, and the
  user leaves the page
- **THEN** the choices made so far are still there on return
- **AND** the user is asked to drop the same file again before continuing

#### Scenario: A different file doesn't replace saved work

- **WHEN** saved work is waiting for its file and the user drops a different
  workbook
- **THEN** the saved work is kept, and the user is told the file doesn't match
- **AND** can either import the new file instead, which lets the saved work go,
  or keep the saved work and drop the right file

#### Scenario: A finished import doesn't come back

- **WHEN** a full import has finished and the user returns to the import
  screen later
- **THEN** a fresh screen is ready for the next import

### Requirement: Check for problems before committing

The user SHALL be able to check a target's rows for problems before
importing it for real, seeing the same row-by-row outcome a real run would
report, with nothing written until the user imports for real. Each problem
SHALL name the column the user must fix, by the file's own header, and why.

#### Scenario: Rehearse before importing

- **WHEN** the user checks a target before importing it
- **THEN** it reports the same passes and problems a real import would
- **AND** nothing is written until the user imports for real

#### Scenario: A problem names the column to fix

- **WHEN** a checked row has a value its column refuses, such as a date written `23-10-2026`
- **THEN** the problem names that column, as the file's header writes it, and the reason

### Requirement: Imports preserve corrections
A Table that keeps change history SHALL preserve a field whose latest change was made by a person when a re-import supplies a different value, and list the conflict with both values, the last editor and time, and the import. Fields last changed by an import SHALL follow the source; this rule applies equally to the import screen and scripted imports.

#### Scenario: Only the corrected field is protected
- **WHEN** the user imports North and a phone number, corrects North to South, then re-imports East and a new phone number
- **THEN** South stays, the phone number updates, and one conflict records South and East with the editor, time and import

#### Scenario: Unchanged source raises nothing
- **WHEN** a corrected field receives its current value or the value the previous import supplied
- **THEN** the correction stays and no new conflict is raised

### Requirement: People resolve import conflicts
The user SHALL be able to keep a correction or take the incoming value, with the decision recorded as their edit. Keeping suppresses the same incoming value on later imports; taking the source lets later imports update that field again.

#### Scenario: Keep a correction
- **WHEN** the user keeps South instead of East and later imports East again
- **THEN** the conflict stays closed
- **AND** importing West raises a new conflict

#### Scenario: Adopt the source
- **WHEN** the user adopts East and a later import supplies West
- **THEN** West updates the field without a conflict

### Requirement: Conflicts respect row and field access
The conflict list SHALL show only rows and fields the user may read. Resolving a conflict SHALL require permission to edit that field of that row.

#### Scenario: Restricted field
- **WHEN** a user cannot read a field that has a conflict
- **THEN** neither its conflict nor its values are shown to that user

### Requirement: Preview explains protected fields
The import check SHALL count fields it will update and fields it will keep and flag, per Table. When a Table keeps no change history, the check SHALL explain that imports overwrite existing values.

#### Scenario: Check a correction
- **WHEN** a re-import would update one untouched field and conflict with one correction
- **THEN** the check reports one updated field and one kept field before anything commits
