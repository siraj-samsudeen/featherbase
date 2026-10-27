## ADDED Requirements

### Requirement: A release warns when the configured Administrator password is not the live one

When the operator has set the Administrator password in the deployment settings, a release and its rehearsal SHALL warn, and go ahead, if that is not the Administrator's live password. Changing the setting never changes the live password, so the warning names the command that does. Neither password is ever shown.

#### Scenario: A half-done password rotation

- **WHEN** an operator changes the Administrator password setting but not the live password, and releases
- **THEN** the release warns that the setting is not the live password and names the command that changes it
- **AND** the release still completes, and neither password appears in its output

#### Scenario: The setting matches

- **WHEN** the setting holds the Administrator's live password
- **THEN** the release says they match and gives no warning
