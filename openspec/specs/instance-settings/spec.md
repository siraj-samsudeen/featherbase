# instance-settings Specification

## Purpose
An instance's settings live in one reviewed file, so every environment of the
instance stays the same unless the file says a value should differ. Every
change to a setting has a review and a history.

## Requirements

### Requirement: Apply the settings file to an environment

Applying the instance's settings file SHALL make that environment's managed
settings match the file, with the environment's own section on top. It SHALL
report exactly which settings it changed, or that nothing changed.

#### Scenario: A missing company domain is restored

- **WHEN** the file lists four company domains for Google sign-in and an
  environment has none, and the owner applies the file to that environment
- **THEN** that environment's Google sign-in accepts the four domains, and
  the result names that one setting as changed

#### Scenario: Applying an unchanged file

- **WHEN** the owner applies the same file to an environment a second time
- **THEN** the result says nothing changed

### Requirement: Values that differ by environment are declared

A setting SHALL differ between environments only when the file's section for
an environment says so. That section is the list of intended differences.

#### Scenario: A job is off only on dev

- **WHEN** the file switches a scheduled job on, and its dev section switches
  it off
- **THEN** applying the file leaves the job on in prod and off on dev

### Requirement: A setting can take its value from a variable

A setting in the file MAY name a variable instead of holding a value. Applying
the file SHALL read that variable and save its value, and SHALL never show the
value, in a preview or anywhere else. A variable holding a secret SHALL be
refused.

#### Scenario: A dive's id differs by environment

- **WHEN** the file's dev section says a dive's id comes from a variable, the
  variable is set, and the user applies the file to dev
- **THEN** the setting holds that value and is locked as usual, and the result
  says the setting changed without showing the value

#### Scenario: The variable is missing

- **WHEN** the variable is not set or is empty, and the user applies or previews
  the file
- **THEN** nothing changes, and the problems name that variable

### Requirement: The file brings back an instance's data sources

The file SHALL be able to name an instance's data sources, by which variable
holds each connection and never the connection itself.

#### Scenario: After a wipe

- **WHEN** an instance's database was wiped and the user applies the file
- **THEN** its data sources are back, and a table read from one can be reflected
  again

### Requirement: Preview before applying

The owner SHALL be able to see what applying a file would change in an
environment without changing anything.

#### Scenario: Reviewing a change before merging it

- **WHEN** the owner previews a file that adds a company domain
- **THEN** the preview names the setting and its old and new value, and the
  environment is unchanged

### Requirement: A wrong file changes nothing

Applying a file that names a setting the instance does not have, or holds a
value the setting refuses, SHALL change nothing and name the problem.

#### Scenario: A setting that was renamed

- **WHEN** the file still uses a setting's old name after an upgrade renamed it
- **THEN** applying it changes nothing and names the unknown setting

### Requirement: Export an environment's settings

The owner SHALL be able to export an environment's current settings in the
file's own shape, so an instance can start its file from a running
environment. An export SHALL never contain a secret.

#### Scenario: Starting the file from prod

- **WHEN** the owner exports prod's settings and applies the result to prod
- **THEN** the result says nothing changed

### Requirement: Managed settings are read-only in Admin

A setting the file manages SHALL be read-only in Admin and SHALL say that
it is changed through the instance's settings file.

#### Scenario: Trying to clear the allowed domains

- **WHEN** a System Manager opens the Google sign-in method on an environment
  where the file manages its allowed domains
- **THEN** the domains cannot be edited there, and the form says where they
  are changed

### Requirement: Emergency changes are recorded

An operator's command-line change to a managed setting SHALL be recorded with
who made it and when, and SHALL show as differing from the file until the
file catches up.

#### Scenario: Blocking a domain at once

- **WHEN** an operator removes a domain from the command line without a
  change to the file
- **THEN** the activity log records the change, and instance health shows the
  setting as differing from the file

### Requirement: Every deployment variable is declared

Featherbase SHALL declare every deployment variable it reads: what it is for,
whether it is a secret, and when it is required. The deployment guide and an
example environment file SHALL be generated from that declaration.

#### Scenario: Setting up a new environment

- **WHEN** someone prepares a new environment
- **THEN** the example environment file lists each variable, says which are
  secrets, and says which the environment must have

### Requirement: A missing required variable stops the release

A release, and a server start, SHALL refuse while a variable that environment
requires is missing, and SHALL name the variable. A missing recommended
variable SHALL warn and let the release go ahead.

#### Scenario: No web address on a hosted environment

- **WHEN** a hosted environment is released without its web address
- **THEN** the release refuses before changing anything and names the missing
  variable

#### Scenario: No upload folder

- **WHEN** an environment is released without its persistent upload folder
- **THEN** the release goes ahead with a warning, and instance health shows
  the missing variable

### Requirement: A feature's secret is required while the feature is on

A feature the settings turn on SHALL make its own secret required. Applying a
file SHALL refuse to turn the feature on in an environment that lacks the
secret.

#### Scenario: Turning on Google sign-in too early

- **WHEN** the owner applies a file that turns on Google sign-in for an
  environment without the Google secret
- **THEN** applying it changes nothing and names the missing secret

### Requirement: The settings file can set how often a job runs

The settings file SHALL be able to set how often a scheduled job runs, as well
as whether it runs, from the same fixed list an admin chooses from. A cadence
the file sets SHALL be read-only in Admin, and a cadence not on the list SHALL
be refused with nothing changed.

#### Scenario: Running a job every four hours

- **WHEN** the file sets a daily job to run every four hours and the owner
  previews, then applies it
- **THEN** the preview names the cadence as the setting that would change,
  the apply changes it, and Admin shows the cadence as set in the file

#### Scenario: A made-up cadence

- **WHEN** the file sets a job to run fortnightly
- **THEN** the apply is refused, pointing at that job's cadence, and nothing
  changes
