## ADDED Requirements

### Requirement: A save hands back what it saved

Saving a row on a connected table SHALL hand back the row exactly as that save left it, even when something else writes to the same row at the same moment. A new row that can't be found again once written SHALL be refused, and nothing is left behind at the data source.

#### Scenario: Another program edits the row at the same moment

- **WHEN** the user saves a row while another program changes the same row at the data source
- **THEN** the user sees the values they saved, and the other program's change lands after the save rather than inside it

#### Scenario: A new row the data source numbers on its own terms

- **WHEN** a data source fills in a new row's id itself, in a way Featherbase can't read back, and the user saves a new row without giving an id
- **THEN** the save is refused, and no row is added at the data source
