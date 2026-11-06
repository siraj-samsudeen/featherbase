## ADDED Requirements

### Requirement: Only Tables the person can read are offered

The import targets SHALL leave out any Table the person is refused, such as an app's Table protected by a role they don't hold, and SHALL still offer the rest. Any other failure to load a Table's details SHALL stop the wizard and say so, rather than quietly offering fewer Tables.

#### Scenario: A System Manager without an app's role

- **WHEN** a System Manager who doesn't hold an app's role drops a file, with that app's protected Tables installed
- **THEN** the wizard carries on, and offers every Table they can read
- **AND** the protected Tables are not offered

#### Scenario: An outage is not an empty list

- **WHEN** a Table's details can't be fetched because of an outage
- **THEN** the wizard reports the failure instead of leaving that Table out
