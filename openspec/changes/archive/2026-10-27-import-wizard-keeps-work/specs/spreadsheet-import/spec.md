## MODIFIED Requirements

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
