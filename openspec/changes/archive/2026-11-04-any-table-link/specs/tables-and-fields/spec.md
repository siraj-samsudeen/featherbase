## ADDED Requirements

### Requirement: Link to a row of any table

A link column SHALL be able to point at a row of a table chosen on each row, from the tables the column allows. The table is chosen first, then a row of it, and the row is shown by its name.

#### Scenario: A decision about a plant and a business unit

- **WHEN** the user records one decision about plant 8151 and another about business unit PKN-GOLD, in a column allowing plants and business units
- **THEN** each decision shows the record it is about by name, and opens it

#### Scenario: Choosing another table clears the row

- **WHEN** the user has picked a plant and then changes the table to business units
- **THEN** the plant is cleared, and only a business unit can be picked

### Requirement: A link to any table is checked when saved

A link to a row of any table SHALL be saved only when its table is one the column allows and that row exists. A new or changed link SHALL also be to a row the person can see. Only a table that stores its own rows can be allowed, never nested rows, a settings table or a table kept in a connected database.

#### Scenario: A plant that isn't there

- **WHEN** the user links a decision to plant PKN-GOLD, which is a business unit, not a plant
- **THEN** the save is refused, saying that plant does not exist

#### Scenario: A plant the user can't see

- **WHEN** a user who can't see plants links a decision to plant 8151
- **THEN** the save is refused, without saying whether that plant exists

### Requirement: A row linked from any table keeps its links

A row SHALL NOT be deleted while a link to any table points at it. Its links SHALL follow when the row gets a new id, or when its table is renamed. A table SHALL NOT be deleted while such a column allows it or a row links into it.

#### Scenario: Deleting a plant a decision is about

- **WHEN** the user deletes plant 8151 while a decision links to it
- **THEN** the delete is refused, naming the decision

#### Scenario: Renaming the plant's table

- **WHEN** the user renames the table of plant 8151
- **THEN** the decision still links to plant 8151, under the table's new name

### Requirement: A linked row you can't see shows only its table

When a person can't see the row a link to any table points at, the link SHALL show only that row's table, and SHALL NOT open the row.

#### Scenario: A clerk reads a decision about a plant

- **WHEN** a clerk who can't see plants opens a decision linked to plant 8151
- **THEN** the link reads as a plant the clerk has no access to, and does not open
