## MODIFIED Requirements

### Requirement: Search only reaches what the user can read

Searching SHALL only match rows the user can open, including any limit to
rows they created or to a chosen set of rows. It SHALL never match rows from
a Table whose data lives in a connected outside database, nor from a Table
of an app that is turned off. A turned-off app SHALL NOT stop search from
answering with matches from every other Table.

#### Scenario: Search stays within the user's own rows

- **WHEN** a search matches both a customer the user created and a customer
  someone else created, and the user is limited to their own rows
- **THEN** only the customer the user created appears

#### Scenario: Search stays within the user's region

- **WHEN** a search matches customers inside and outside the one region the
  user is allowed to access
- **THEN** only customers in the user's region appear

#### Scenario: A connected table is invisible to search

- **WHEN** the user searches for a value that only exists in a row of a
  Table connected to an outside database
- **THEN** no result for that row appears, even though the Table itself can
  still be opened

#### Scenario: A turned-off app does not break search

- **WHEN** an installed app is turned off and someone searches for a value
  found both in one of that app's Tables and in an ordinary Table
- **THEN** the ordinary Table's row appears and the app's row does not
- **AND** once the app is turned back on, its row appears again
