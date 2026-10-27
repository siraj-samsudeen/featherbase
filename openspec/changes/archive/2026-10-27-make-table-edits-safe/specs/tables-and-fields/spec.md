## MODIFIED Requirements

### Requirement: Removing a column keeps its values

Taking a column out of a table's definition SHALL hide it without deleting
the values stored under it, and putting a column of the same name back
brings those values back. Values are deleted only when the builder
explicitly asks for that.

A column SHALL come out only when the change names it for removal. A change
that simply leaves a column out is refused, naming the column and saying how
many rows hold a value in it, and nothing is changed.

#### Scenario: Put a column back

- **WHEN** a "points" column is taken out of a table and later added back
- **THEN** every row shows the points it had before

#### Scenario: A column left out by accident

- **WHEN** the user saves a table's definition that lists only its "title"
  column, leaving out a "points" column that two rows have filled in
- **THEN** the save is refused, saying "points" was left out while two rows
  hold a value in it, and the table keeps both columns

### Requirement: Rename a column or its label without losing data

The Columns screen SHALL let a builder relabel a column (the name shown to
everyone) or rename it (its machine name) at any time; either way, the
values already stored under it stay attached and readable under the new
name. A definition change that takes one column out and adds another is
never read as a rename; it is refused like any other unasked removal.

#### Scenario: Fix a misspelled column name

- **WHEN** a column named "glor" is renamed to "floor"
- **THEN** every row's existing value moves with it and is readable under
  "floor"

#### Scenario: A rename typed as a new column

- **WHEN** the user saves a definition that replaces a filled-in "title"
  column with a new "headline" column
- **THEN** the save is refused, saying how to rename "title" instead, and
  every row still shows its title

### Requirement: A column can be marked unique

A column marked unique SHALL refuse a value another row already holds in it,
calling out the column, rather than storing a second copy. Marking an
existing column unique while its rows repeat a value is refused, naming the
column and the repeated value, and the table is left as it was.

#### Scenario: Reuse a code another row has

- **WHEN** a row is saved with the code "DUP" that another row already has
- **THEN** the save is refused and the code column is called out as needing
  to be unique

#### Scenario: Mark a column unique after rows repeat a value

- **WHEN** the user marks a code column unique while two rows hold the code
  "A"
- **THEN** the change is refused, naming the code column and "A", and the
  column stays as it was

## ADDED Requirements

### Requirement: A link column points at a table that exists

A link column SHALL name a table that exists, the table it belongs to, or
another table the same app installs with it. A definition naming a missing
table is refused, naming that table, so no table is left unable to take a
value in that column.

#### Scenario: Link to a table that isn't there

- **WHEN** the user adds a link column pointing at a table called
  "NoSuchTable"
- **THEN** the change is refused, naming "NoSuchTable", and the column is
  not added
