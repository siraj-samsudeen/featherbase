# Trusted Runtime Packages

## MODIFIED Requirements

### Requirement: An app can bring its own scheduled jobs

An app SHALL be able to declare scheduled jobs, each with how often it runs by
default, what it does, and whether it starts switched on. Installing the app
SHALL add each job to the scheduled jobs page under the app's name, where an
admin manages it like any other scheduled job. A job the app ships switched
off runs only once an admin switches it on.

#### Scenario: A daily job arrives with the app

- **WHEN** the user installs an app that declares a daily job to disable
  people who have left
- **THEN** the scheduled jobs page lists that job under the app's name, set
  to run daily, and it runs without anyone starting it

#### Scenario: A job that ships switched off

- **WHEN** the user installs an app whose daily job is declared switched off
- **THEN** the scheduled jobs page lists the job as off, and it does not run
  until an admin switches it on

### Requirement: An app's job can do only what it declares

An app's job SHALL run as itself, not as a person, and SHALL be able to do only
what the app declares for it: seeing the instance's people, disabling a person,
or emailing the System Managers. A job that sees people sees only the
identifiers and the sign-ins it names. Anything else SHALL be refused and recorded,
and the job SHALL never disable an administrator.

#### Scenario: A job that disables people

- **WHEN** a job declared to disable people runs and finds a person who has
  left and a System Manager who has left
- **THEN** the person is disabled, with the job named as the one who did it,
  and the System Manager is left as they are

#### Scenario: A job tries something it did not declare

- **WHEN** a job declared only to see people tries to disable someone
- **THEN** the person stays enabled, the run is recorded as failed and is not
  retried, and the access log records the refusal

#### Scenario: A job sees only the sign-ins it names

- **WHEN** a job that names one sign-in service lists the instance's people
- **THEN** it sees each person's account at that service, and nothing of
  their other sign-ins
