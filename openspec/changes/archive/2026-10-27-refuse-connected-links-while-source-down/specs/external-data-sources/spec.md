## MODIFIED Requirements

### Requirement: A Featherbase table can link to a connected table

A Featherbase table SHALL be able to link its rows to rows of a connected table. Saving checks the linked row on the data source: the row saves when the linked row is there, and the user is told it does not exist when it is not. While the data source can't be reached, a save that sets such a link is refused, because the link can't be checked.

#### Scenario: Link a local row to a connected row

- **WHEN** the user saves a row in a "Holders" table whose account link points at an account that exists in a connected "Accounts" table
- **THEN** the row saves with that link

#### Scenario: Link to a connected row that isn't there

- **WHEN** the user saves a row whose account link names an account the data source does not have
- **THEN** the row is not saved, and the user is told that account does not exist

#### Scenario: Link to a connected row while its data source is down

- **WHEN** the "Accounts" data source stops responding and the user saves a "Holders" row with an account link
- **THEN** the row is not saved, and the user is told the data source can't be reached
