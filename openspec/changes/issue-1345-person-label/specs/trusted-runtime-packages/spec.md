## ADDED Requirements

### Requirement: An app may describe people

An app MAY name a server read as `person.describe`. Given people, it answers each
one's code, role, place, standing (current, left, consultant, supplier) and
company. Featherbase SHALL ask it once per request, as the viewer, wait about
300 ms, and on a failure or delay show its own layer alone. Where two apps answer, the
first with an appointment wins and the conflict is logged (#1345).

#### Scenario: A slow app

- **WHEN** the app's describe read takes longer than its time
- **THEN** search answers without waiting, showing code and email

#### Scenario: An app's answer about someone the viewer may not read

- **WHEN** the app's answer names a role or place the viewer may not read
- **THEN** nothing of it is shown
