## ADDED Requirements

### Requirement: A notice with nobody to receive it is recorded

When a system notice, such as the leaver-check summary or a waiting-for-access alert, has no System Manager with an email address to go to, the system SHALL record that it reached nobody instead of dropping it silently. Before a release, the system SHALL warn, without stopping the release, when no System Manager other than the built-in Administrator has an email address.

#### Scenario: No System Manager has an email address

- **WHEN** someone signs in for the first time and no System Manager has an email address
- **THEN** the activity log shows that the alert reached nobody, and why

#### Scenario: A new instance is released

- **WHEN** an instance whose only System Manager is the built-in Administrator is released
- **THEN** the release goes ahead and warns that alerts will reach nobody until a System Manager has an email address
