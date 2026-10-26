# Search and Explore Delta

## MODIFIED Requirements

### Requirement: Search only reaches what the user can read

Searching SHALL only match rows the user can open, including any limit to
rows they created or to a chosen set of rows. It SHALL never match rows from
a Table whose data lives in a connected outside database.

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

## ADDED Requirements

### Requirement: Search only uses information the user can read

Search SHALL neither match nor display a sensitive value the user is not
allowed to read. A row that matches by its ID SHALL remain available, using
that ID in place of its sensitive title.

#### Scenario: A secret title alone does not produce a match

- **WHEN** a user searches for text found only in a sensitive title they are
  not allowed to read
- **THEN** that row does not appear

#### Scenario: A visible row keeps its secret title hidden

- **WHEN** a user searches for the ID of a row they can open, but its title is
  sensitive to them
- **THEN** the row appears using its ID, without the sensitive title

#### Scenario: Deeper access includes the title

- **WHEN** a user with access to the sensitive title searches for text in it
- **THEN** the matching row appears with that title
