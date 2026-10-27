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
