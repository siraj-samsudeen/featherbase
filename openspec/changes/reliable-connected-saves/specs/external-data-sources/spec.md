## ADDED Requirements

### Requirement: A save hands back what it saved

Saving a row on a connected table SHALL hand back the row exactly as that save left it, even when something else writes to the same row at the same moment. A new row that can't be found again once written SHALL be refused, and nothing is left behind at the data source.

#### Scenario: Another program edits the row at the same moment

- **WHEN** the user saves a row while another program changes the same row at the data source
- **THEN** the user sees the values they saved, and the other program's change lands after the save rather than inside it

#### Scenario: A new row the data source numbers on its own terms

- **WHEN** a data source fills in a new row's id itself, in a way Featherbase can't read back, and the user saves a new row without giving an id
- **THEN** the save is refused, and no row is added at the data source

### Requirement: A refused save says why in plain words

When a data source refuses a save or a delete, because a value it needs is missing, a link points at a row it doesn't have, a value breaks one of its rules or doesn't fit, or other rows there still point at the row, Featherbase SHALL tell the user in plain words, on the field concerned wherever it can tell which one. The data source's own error text SHALL NOT be shown to the user.

#### Scenario: The data source needs a value the form didn't ask for

- **WHEN** the data source starts requiring a value after its table was connected, and the user saves a row without it
- **THEN** the save is refused and that field is marked as required, with no database message on screen

#### Scenario: Deleting a row the data source still uses

- **WHEN** the user deletes a connected row that other rows at the data source still point at
- **THEN** the delete is refused with a plain message saying other rows still point at it, and the row stays
