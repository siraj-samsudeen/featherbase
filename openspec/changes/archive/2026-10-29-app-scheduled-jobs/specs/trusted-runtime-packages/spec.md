## ADDED Requirements

### Requirement: An app can bring its own scheduled jobs

An app SHALL be able to declare scheduled jobs, each with how often it runs by
default and what it does. Installing the app SHALL add each job to the
scheduled jobs page under the app's name, where an admin manages it like any
other scheduled job.

#### Scenario: A daily job arrives with the app

- **WHEN** the user installs an app that declares a daily job to disable
  people who have left
- **THEN** the scheduled jobs page lists that job under the app's name, set
  to run daily, and it runs without anyone starting it

### Requirement: An app's job can do only what it declares

An app's job SHALL run as itself, not as a person, and SHALL be able to do only
what the app declares for it: seeing the instance's people, disabling a person,
or emailing the System Managers. Anything else SHALL be refused and recorded,
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

### Requirement: An app's jobs follow the app

Turning an app off SHALL stop its jobs, turning it on SHALL start them again,
and removing it SHALL remove them. An upgrade SHALL add, change or remove the
app's jobs as the new version says, once the new version is turned on, and
SHALL keep a cadence an admin chose.

#### Scenario: Turning the app off and on

- **WHEN** the user turns an app off and later back on
- **THEN** its jobs do not run while it is off, and run again once it is on

#### Scenario: An upgrade changes the jobs

- **WHEN** the new version of an app runs one job hourly instead of daily,
  adds a job, and drops another
- **THEN** the upgrade preview lists all three changes, and once the new
  version is turned on the scheduled jobs page matches it

### Requirement: An upgrade can't give a job new access

An upgrade SHALL NOT let a job do something its installed version was not
allowed to do; a job that would gain access SHALL need a reviewed install.

#### Scenario: A job that would gain the right to disable people

- **WHEN** the new version of an app lets a job disable people when the
  installed version only let it see them
- **THEN** the upgrade preview is refused and says why

### Requirement: A job name belongs to one owner

An app SHALL NOT take the name of a scheduled job that Featherbase or another
app already has; installing it SHALL be refused and leave nothing behind.

#### Scenario: A name already in use

- **WHEN** the user installs an app whose job would have the same name as an
  existing scheduled job
- **THEN** the install is refused, naming who has the job, and the existing
  job is unchanged
