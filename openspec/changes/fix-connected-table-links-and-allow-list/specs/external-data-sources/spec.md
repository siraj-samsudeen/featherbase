## ADDED Requirements

### Requirement: A Featherbase table can link to a connected table

A link column in an ordinary Featherbase table SHALL be able to point at a connected table. Saving a row checks the linked row on the data source: the row saves when it is there, and the user is told the linked row does not exist when it is not.

#### Scenario: Link a local row to a connected row

- **WHEN** the user saves a row in a "Holders" table whose account link points at an account that exists in a connected "Accounts" table
- **THEN** the row saves with that link

#### Scenario: Link to a connected row that isn't there

- **WHEN** the user saves a row whose account link names an account the data source does not have
- **THEN** the row is not saved, and the account field says that account does not exist

## MODIFIED Requirements

### Requirement: A data source can be limited to named tables

A System Manager SHALL be able to list the only tables a data source may
connect. A table outside the list is refused, however it is asked for. When
several tables are asked for together and any one is refused, none of them
is connected.

#### Scenario: A table that isn't on the list

- **WHEN** a data source lists one allowed table and a System Manager tries to
  connect a different table from it
- **THEN** it is refused, saying the table is not on the data source's list
- **AND** the allowed table connects normally

#### Scenario: One refused table among several

- **WHEN** a System Manager asks to connect two allowed tables and one that is
  not on the list, all at once
- **THEN** the request is refused, naming the table that is not on the list
- **AND** neither allowed table is connected
