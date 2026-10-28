## ADDED Requirements

### Requirement: A number column gives back a number

A whole number SHALL read back as a number, not as text, including from a table connected to another database.

#### Scenario: Read back a count

- **WHEN** the user saves a count of 13 and reads the row back
- **THEN** the count is the number 13, so adding it to other counts gives a sum, not joined text

#### Scenario: Read a count from a connected table

- **WHEN** a table connected to another database holds a count of 13 and the user reads that row
- **THEN** the count is the number 13, as it would be in a table kept here

### Requirement: A JSON column holds the data typed into it

JSON typed into a form SHALL be saved as the data it describes. Text that isn't valid JSON SHALL be refused at that field with a message, and the row SHALL NOT be saved.

#### Scenario: Type a small object

- **WHEN** the user types `{"shelf": 3}` into a JSON column and saves
- **THEN** the column holds an object whose shelf is 3, not the text of it

#### Scenario: Type something that isn't JSON

- **WHEN** the user types `{shelf: 3` into a JSON column and saves
- **THEN** the field says it must be valid JSON and nothing is saved
