## ADDED Requirements

### Requirement: A change to many rows happens to all of them or none

When the user changes or deletes several rows at once and one of them can't
be changed, no row SHALL change, and the user SHALL be told which row and
why. A table connected to an outside source can't undo a partly done change,
so there every row is tried and the rows that failed stay selected, each
named with its reason.

#### Scenario: One row can't be deleted

- **WHEN** the user selects three rows and deletes them, and the second has
  been submitted meanwhile
- **THEN** all three rows stay, and the user is told that nothing was
  deleted because the second row is submitted

#### Scenario: A connected table deletes what it can

- **WHEN** the user deletes three rows of a table connected to an outside
  database, and one of them was removed there meanwhile
- **THEN** the other two are deleted, the missing row stays selected, and
  the user is told that two of three were deleted and that row was not found

### Requirement: A refused change to many rows says what to fix

When a change to several rows is refused, the user SHALL be told each field
that was refused and why, not only that the values were invalid.

#### Scenario: A required field is cleared

- **WHEN** the user selects rows and clears a field every row must have
- **THEN** the user is told that field is required, and no row changes
