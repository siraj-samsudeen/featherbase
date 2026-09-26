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
  "INV"
- **THEN** new rows are named INV.0001, INV.0002 and so on in order

### Requirement: A series never reuses a number

Once a series has issued a number, deleting the row that used it SHALL NOT
free that number for reuse. Every later row from the same series gets the
next number after the highest one ever issued, even after the row that used
it, or the whole Table, is gone.

#### Scenario: Delete a row and add another

- **WHEN** the row named INV.0005 is deleted and a new row is added to the
  same series
- **THEN** the new row's number continues after 0005, and 0005 is never
  reused

### Requirement: A typed-in name must be unique

If a row's name is typed in directly rather than assigned automatically,
saving it with a name that's already in use SHALL be refused rather than
overwriting the existing row.

#### Scenario: Reuse an existing name

- **WHEN** a user creates a row and types in a name already used by another
  row in that Table
- **THEN** the save is refused and the existing row is untouched
