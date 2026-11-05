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

Re-importing into a table that was matched with a column before SHALL offer that column when still mapped, permitted and usable, named for explicit acceptance or replacement, never applied silently. Other eligible mapped columns whose distinct nonblank incoming values match every incoming row one-to-one with readable existing rows SHALL also be offered using the existing matching rules, without guessing which column identifies the rows or disclosing unreadable values.

#### Scenario: The same matching column is suggested next time

```gherkin
Given the user has imported 61 zones matched on their zone codes
When the user prepares the zones file for another import
Then zone codes are offered as the remembered matching column
And no matching column is active until the user accepts or chooses one
```

#### Scenario: A matching column is offered without a previous keyed import

```gherkin
Given the user has imported 61 zones without choosing a matching column
When the user prepares the identical zones file for another import
Then zone codes are offered because each incoming code matches exactly one readable zone
And no matching column is active until the user accepts or chooses one
```

#### Scenario: Ambiguous values are not offered as a safe match

```gherkin
Given the user has imported zones with repeated zone codes
When the user prepares the zones file for another import
Then the repeated zone codes are not offered as a one-to-one matching column
```

#### Scenario: An unreadable matching column is not offered

```gherkin
Given the user can read the zones but cannot read their zone codes
When the user prepares the identical zones file for another import
Then zone codes are not offered as a matching column or used to disclose overlap
```

#### Scenario: An unmapped remembered column is not offered

```gherkin
Given the user has imported 61 zones matched on their zone codes
When the user prepares another zones file without mapping its zone codes
Then zone codes are not offered as a remembered matching column
```

### Requirement: A fully overlapping append is deliberate

When the user chooses no matching column and every incoming row has a distinct nonblank value matching exactly one readable existing row in an eligible mapped column whose values the user may read, the import SHALL warn that appending adds another set and require explicit acknowledgement before proceeding. The user SHALL be able to choose a matching column instead; deliberate append remains available, and an inability to check overlap SHALL NOT be treated as proof that no rows overlap.

#### Scenario: Appending the identical file waits for acknowledgement

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file without choosing a matching column
Then the import waits for acknowledgement that 61 more rows will be added
And the user can choose the suggested zone codes instead
```

#### Scenario: The acknowledged append adds the second set

```gherkin
Given the user has imported 61 zones with their populations
And the user has been warned that appending the identical zones file adds 61 more rows
When the user explicitly acknowledges the append
Then the zones contain 122 rows
```

#### Scenario: Readable overlap does not require permission to change rows

```gherkin
Given the user can read and append the zones but cannot change existing zones
When the user checks overlap before appending the identical zones file
Then all 61 rows are reported as overlapping without an available matching key
```

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

At import time, a fresh changed-row count across the selected unfinished targets and all their parts SHALL determine whether more than 20 existing rows would change mapped values and require that exact count to be typed. Unchanged matches and retained corrections alone SHALL NOT increase that count; missing or wrong confirmation leaves the import blocked, and changed import choices invalidate confirmation.

#### Scenario: An identical large file needs no change confirmation

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file matched on its zone codes
Then the import proceeds without a typed change count
```

#### Scenario: Twenty changed rows need no typed count

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the zones file with 20 changed populations matched on its zone codes
Then the import proceeds without a typed change count
```

#### Scenario: The count must be typed back

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the zones file with 21 changed populations matched on its zone codes
Then the import waits for the user to type 21
And a missing or wrong count leaves the import blocked
```

#### Scenario: Changes in different parts count together

```gherkin
Given the user has imported 520 zones with their populations
When the user imports the zones file with 11 changed populations among its first 500 zones and 10 among its last 20 matched on zone codes
Then the import waits for the user to type 21
```

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

### Requirement: Re-import previews distinguish value changes

The immediate preview and the user's explicit check SHALL split matched rows into changed and unchanged, with the number of mapped values that will change, alongside added, skipped and refused rows. The explanation SHALL agree with the chosen matching mode; classification changes presentation and confirmation, not import automation, source observations, provenance, undo or historical processed-count meaning.

#### Scenario: An identical file changes no values

```gherkin
Given the user has imported 61 zones with their populations
When the user chooses zone codes to match the identical zones file before requesting a check
Then the preview reports 0 changed rows, 61 unchanged rows and 0 added rows
And the preview reports 0 changed values and explains matching rather than appending
```

#### Scenario: One changed population does not count the whole file

```gherkin
Given the user has imported 61 zones with their populations
When the user checks the zones file with one changed population matched on its zone codes
Then the preview reports 1 changed row, 60 unchanged rows and 0 added rows
And the preview reports 1 changed value
```

#### Scenario: An unchanged re-import is still recorded

```gherkin
Given the user has imported 61 zones with their populations
When the user imports the identical zones file matched on its zone codes
Then import history records 61 processed matches rather than 61 value changes
And undoing that import reports that the 61 matched rows had no values changed
```

### Requirement: Imports preserve corrections
A Table that keeps change history SHALL preserve a field whose latest change was made by a person when a re-import supplies a different value, and list the conflict with both values, the last editor and time, and the import. Fields last changed by an import SHALL follow the source; this rule applies equally to the import screen and scripted imports.

#### Scenario: Only the corrected field is protected
- **WHEN** the user imports North and a phone number, corrects North to South, then re-imports East and a new phone number
- **THEN** South stays, the phone number updates, and one conflict records South and East with the editor, time and import

#### Scenario: Unchanged source raises nothing
- **WHEN** a corrected field receives its current value or the value the previous import supplied
- **THEN** the correction stays and no new conflict is raised

#### Scenario: An automation cannot overwrite a correction
- **WHEN** a save automation would change a corrected field while a re-import updates that row
- **THEN** that row is refused and reported, none of the emails, webhooks or other after-save work it started goes out, and the file's other rows still import

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

The re-import preview and check SHALL separately count rows and differing incoming values that keep a person's corrections, and new conflicts. Retained rows may also contain changes to other mapped values; when change history is off, the check SHALL explain that imports overwrite existing values.

#### Scenario: Check a correction

```gherkin
Given the user has imported 61 zones and corrected the first zone's region from North to South
When the user checks a zones file matched on zone codes with a new East region and a changed population for that zone
Then the preview reports 1 changed row and 1 row keeping the user's correction
And it reports 1 changed value, 1 retained value and 1 new conflict
```

#### Scenario: The previous source retains the correction without another conflict

```gherkin
Given the user has imported 61 zones and corrected the first zone's region from North to South
When the user checks the original zones file matched on its zone codes
Then the preview reports 0 changed rows, 61 unchanged rows and 1 row keeping the user's correction
And it reports 1 retained value and 0 new conflicts
```

#### Scenario: No-history overwrites are explained

```gherkin
Given the user has imported 61 zones without change history and corrected the first zone's region
When the user checks the original zones file matched on its zone codes
Then the preview reports the differing region as a change rather than a retained correction
And the user is warned that imports overwrite existing values without change history
```

### Requirement: A column switched to Choice takes its options from the sheets

A column the user switches to Choice SHALL take as its options every different value in the sheets feeding it, however many there are, and a value with spaces around it SHALL import as that option. A long list shows its first eight options and how many more, with the whole list on hover.

#### Scenario: Many sections become a Choice by hand

```gherkin
Given a sheet whose Section column holds 12 different values
When the user imports it as a new table with Section switched to Choice
Then the new table holds every row
And its Section column offers all 12 values
```

#### Scenario: A long list of options stays readable

```gherkin
Given a sheet whose Section column holds 12 different values
When the user switches Section to Choice in the import wizard
Then the wizard shows the first 8 options and says 4 more
```

#### Scenario: Spaces around a value don't refuse its row

```gherkin
Given a sheet whose Zone column repeats Dairy and Fresh with spaces around them
When the user imports it as a new table
Then the new table holds every row
```

### Requirement: A refused table says why

When the server refuses a table the import would make, the wizard SHALL show the server's reason, naming the column by the label the user sees where it can, not only that the definition is invalid.

#### Scenario: A column with a bad name is named

```gherkin
Given a sheet with a Zone column
When the user imports it as a new table with Zone's column name changed to "Bad Name"
Then the import says the table failed because Column "Zone" must be snake_case
```

### Requirement: Refused rows on a one-sheet import stay on screen

A one-sheet import with any refused row SHALL stay on the wizard and report the refused rows, and SHALL not call itself complete. When every row of a new table is refused nothing has landed, so the target counts as failed and can be corrected and imported again. An import with none refused still goes straight to the table's list.

#### Scenario: Every row is refused

```gherkin
Given a sheet whose Zone column holds only words
When the user imports it as a new table with Zone switched to Int
Then the import says every row was refused
When the user switches Zone back to Data and imports again
Then the new table holds every row
```

### Requirement: Trying again after a dropped connection

If the connection drops after an import has made its new table, importing again SHALL work when no row landed, using the columns as they are now. When rows landed it SHALL refuse, saying how many and where to delete them, so that they are not doubled.

#### Scenario: No row landed

```gherkin
Given a sheet with a Zone column
And the connection drops while the import is sending its rows
When the user imports it as a new table
Then the import says the table failed
When the connection is back and the user imports again
Then the new table holds every row
```

#### Scenario: Some rows landed

```gherkin
Given a sheet with a Zone column
And the connection drops after one row has landed
When the user imports it as a new table
Then the import says the table failed
When the connection is back and the user imports again
Then the import says the table already holds 1 row and to delete it under Past imports
And the new table holds 1 row
```
