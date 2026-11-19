## ADDED Requirements

### Requirement: A settings file sets how the instance's own Tables are found

A settings file MAY set Metadata Overrides, but only person_column,
search_columns and label (a column's label too), never anything about who may
read or change a record. Any other property SHALL be refused, naming it. Applying
the file again changes nothing; an override someone made by hand is replaced and
the apply says so. A Table not loaded yet waits for the next apply (#1345).

#### Scenario: Employee joins its Person

- **WHEN** the Dash instance's settings file is applied once Employee is loaded
- **THEN** Employee's rows fold into their Person in search and are found by their employee code

#### Scenario: A property outside the allowlist

- **WHEN** a settings file names a Metadata Override of read_only
- **THEN** the apply is refused, naming read_only, and nothing changes
