# Trusted Runtime Packages

## MODIFIED Requirements

### Requirement: An app's job can do only what it declares

An app's job SHALL run as itself, not as a person, and SHALL be able to do only
what the app declares for it: seeing the instance's people, disabling a person,
emailing the System Managers, telling a person in Featherbase's notices (and by
email when it asks), or reading every row of the app's own Tables it names.
Anything else SHALL be refused and recorded, and the job SHALL never disable an
administrator.

#### Scenario: A job that disables people

- **WHEN** a job declared to disable people runs and finds a person who has
  left and a System Manager who has left
- **THEN** the person is disabled, with the job named as the one who did it,
  and the System Manager is left as they are

#### Scenario: A job tries something it did not declare

- **WHEN** a job declared only to see people tries to disable someone
- **THEN** the person stays enabled, the run is recorded as failed and is not
  retried, and the access log records the refusal

## ADDED Requirements

### Requirement: An app's job reads its own app's Tables whole
A job SHALL be able to read every row of the app's own Tables that the app names for it, every person's rows included, without changing any. It SHALL NOT be able to name another app's Tables or the platform's.

#### Scenario: The new-run job finds who answered

- **WHEN** a job named to read the app's answers runs, and two people have each answered privately
- **THEN** the job reads both answers, and each person still sees only their own

#### Scenario: A job cannot read another app's Tables

- **WHEN** an app names another app's Table, or a platform Table, for its job to read
- **THEN** the app is refused when it is loaded, naming the Table
