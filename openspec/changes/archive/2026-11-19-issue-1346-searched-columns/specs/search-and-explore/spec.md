## ADDED Requirements

### Requirement: A Table can name more columns that search matches

A Table SHALL be able to name more of its columns that search matches, besides
a row's name and title, so a record is found by a code or login it holds. A
match on such a column SHALL show the row by its title as usual, and SHALL never
happen for a viewer who may not read that column (#1346).

#### Scenario: A login finds its account

- **WHEN** a Table of accounts names its login column for search, and the user
  searches for an account's login
- **THEN** the account appears, shown by its name

#### Scenario: A hidden column finds nothing

- **WHEN** the user may not read the login column and searches for a login
- **THEN** no account appears for that login
