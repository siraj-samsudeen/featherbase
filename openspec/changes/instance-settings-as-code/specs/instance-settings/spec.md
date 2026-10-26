# Spec Delta

## Purpose

An instance's settings live in one reviewed file, so every environment of the
instance stays the same unless the file says a value should differ. Every
change to a setting has a review and a history.

## ADDED Requirements

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
