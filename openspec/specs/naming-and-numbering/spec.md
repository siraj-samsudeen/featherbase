# Naming and Numbering

## Purpose

Every row needs an id the moment it's created. A Table developer chooses how
that id is produced, so it fits how the data is normally identified — a
random id, a numbered series, a name the row's own creator types in, or a
name taken from one of the row's own fields.

## Requirements

### Requirement: Choose how new rows are named

A Table developer SHALL choose how its rows are named: a random id assigned
automatically, a numbered series with a chosen prefix, a name typed in by
whoever creates the row, or a name taken from one of the row's own fields.

#### Scenario: Switch a Table to a numbered series

- **WHEN** a developer sets a Table's naming to a series with the prefix
  "INV-" and three digits
- **THEN** new rows are named INV-001, INV-002 and so on in order, and rows
  saved before the switch keep their ids

### Requirement: A series never reuses a number

Once a series has issued a number, deleting the row that used it SHALL NOT
free that number for reuse. Every later row from the same series gets the
next number after the highest one ever issued, even after the row that used
it, or the whole Table, is gone.

#### Scenario: Delete a row and add another

- **WHEN** the row named INV-005, the newest in its series, is deleted and a
  new row is added to the same series
- **THEN** the new row is named INV-006, and 005 is never reused

### Requirement: A typed-in name must be unique

If a row's name is typed in directly rather than assigned automatically,
saving it with a name that's already in use SHALL be refused rather than
overwriting the existing row.

#### Scenario: Reuse an existing name

- **WHEN** a user creates a row and types in a name already used by another
  row in that Table
- **THEN** the save is refused and the existing row is untouched

### Requirement: Rows saved at the same moment never share a number

When many rows of a numbered series are saved at the same moment, each SHALL
get its own number, with no repeats and no gaps.

#### Scenario: Fifty saves at once

- **WHEN** fifty rows of the same series are saved at the same moment
- **THEN** they are numbered 1 to 50, each number used exactly once

### Requirement: A name that comes from the row can't be left out

A row named by a name its creator types in, or by one of its own fields,
SHALL be refused when that name or field is left empty.

#### Scenario: The naming field is blank

- **WHEN** a row of a Table named after its country column is saved with no
  country
- **THEN** the save is refused and the country column is called out

### Requirement: The new-row form asks for a typed-in name

When a Table's rows are named by whoever creates them, the form for a new row SHALL ask for that name, and leaving it blank SHALL call out the name rather than only refusing the save.

#### Scenario: Add a row from the form

- **WHEN** the user opens a new row of a Table whose rows they name, types "shelf-a1" as its name and saves
- **THEN** the row is saved under the name "shelf-a1" and opens

#### Scenario: Forget the name

- **WHEN** the user fills in a new row of that Table but leaves its name blank and saves
- **THEN** nothing is saved, the name is called out as required, and what they typed stays on screen
