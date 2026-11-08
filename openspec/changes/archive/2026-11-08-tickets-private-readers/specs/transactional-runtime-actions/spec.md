# Transactional Runtime Actions

## ADDED Requirements

### Requirement: An action names who else reads one of the app's own rows

An action SHALL be able to name the people who, besides those its grants already let read it, read one row of a Table the app owns, replacing the people it named before. They SHALL read only that row, and only read it. A person who is not enabled is left out.

#### Scenario: A person named reads the row until they are no longer named

- **WHEN** an action names a person as a reader of one of the app's rows
- **THEN** that person opens the row, and no other row of that Table
- **AND** when the action names someone else instead, the first person no longer opens it

### Requirement: Only someone who reads the row names its readers

The host SHALL refuse to name readers for a Table the app does not own and for a caller who cannot read the row, and SHALL leave alone a share that lets someone change the row.

#### Scenario: Someone who cannot read the row cannot name its readers

- **WHEN** the action runs for someone who cannot read the row
- **THEN** it is refused and nobody is named

### Requirement: A read asks whether its caller was named a reader

An app's action or read SHALL be able to ask whether its caller is one of the people named to read a row, and the answer SHALL be no once that row no longer opens for them.

#### Scenario: A colleague who was not named

- **WHEN** a read asks for someone who reads the row only through their own role
- **THEN** the answer is no
