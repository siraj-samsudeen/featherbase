# List View

## ADDED Requirements

### Requirement: Authored initial browsing
A Table MAY declare default filters and a preferred direct reverse-reference connection. These settings SHALL affect presentation only and SHALL NOT change permission checks or canonical identifiers.

#### Scenario: Opening a table without URL filters
- **GIVEN** a table declares a default enabled filter
- **WHEN** a user opens its bare list URL
- **THEN** the visible filters, rows and total use that filter

#### Scenario: Explicit audit view
- **GIVEN** a table declares default filters
- **WHEN** a user opens its URL with an explicit empty filter array
- **THEN** the list uses no default filters and retains the explicit empty array when filters are cleared

#### Scenario: Preferred related records
- **GIVEN** a table declares a preferred target table and reverse-reference column
- **WHEN** a readable record and its connections finish loading
- **THEN** that exact connection opens inline
- **AND** later user close or tab choices are respected

#### Scenario: Display names do not rename storage
- **GIVEN** a table has a display label
- **WHEN** a user opens the table or its record
- **THEN** the label is displayed while links, storage and references keep the canonical identifier
