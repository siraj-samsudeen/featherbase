## ADDED Requirements

### Requirement: An update to a Table changes only what it names

An update to a Table's definition SHALL change only what it names. A setting or the columns left out SHALL stay as they were, and only an explicit empty value SHALL clear a setting.

#### Scenario: Only the columns

- **WHEN** an update names only a Table's columns
- **THEN** the columns change, and its title column, description and every other setting stay

#### Scenario: Only a setting

- **WHEN** an update names only a Table's description
- **THEN** the description changes, and its columns and other settings stay

#### Scenario: An explicit empty value

- **WHEN** an update sends an empty title column
- **THEN** the Table has no title column
