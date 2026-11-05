# Transactional Runtime Actions

## ADDED Requirements

### Requirement: An app reads and proposes only on Tables it declares and an administrator lists

An app MAY declare base Tables of the instance, with the columns it reads and the columns it proposes on. It SHALL read and propose on one only when the Table is both declared and listed by an administrator in the app's linked Tables setting, and only the declared columns. These reads SHALL run as the app, so the caller needs no permission on the Table. A read SHALL NOT be able to propose or decide.

#### Scenario: Not listed

- **WHEN** an app reads a declared Table an administrator hasn't listed
- **THEN** the read is refused

#### Scenario: A column it didn't declare

- **WHEN** an app asks for a column it didn't declare, or proposes on one
- **THEN** it is refused
