## ADDED Requirements

### Requirement: A new Table's link column names the Table it links to

Choosing Reference for a column of a new Table SHALL show a picker of the Tables the person can read, and the Table SHALL be made with that link. Import SHALL wait until every link column in use has its Table, saying which columns need one.

Check SHALL be offered on a new Table with a link column, and SHALL report each row whose value is not the row ID of a row of the target. A value matches by row ID alone: a target named by a name column matches that name, and a target keyed by a code does not match a value holding its name. Check makes nothing, and a retired target row still matches.

#### Scenario: Importing stores with a link to their cluster

- **WHEN** a person imports a file as a new Table, sets a column to Reference and picks the cluster Table
- **THEN** the new Table's column links to the cluster Table, and its rows open their cluster

#### Scenario: No Table picked yet

- **WHEN** a link column in use has no Table picked
- **THEN** Import is disabled, and a message names the column

#### Scenario: A value with no row

- **WHEN** a person runs Check and a file value matches no row of the target
- **THEN** that row is reported with the value and the Table, saying links match a row's ID
- **AND** no Table is made
- **AND** importing still lands the other rows and reports that one
