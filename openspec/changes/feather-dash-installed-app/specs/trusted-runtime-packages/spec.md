## ADDED Requirements

### Requirement: An app can bring its own report data

An app SHALL be able to define report data that Featherbase refreshes on a schedule
and serves to the app's readers. A refresh that fails or looks incomplete SHALL never
replace the last good copy. Readers SHALL only ever receive the part their own access
allows.

#### Scenario: A half-finished refresh is never served

- **WHEN** a scheduled refresh of an app's report data comes back far smaller than the
  last good copy
- **THEN** readers keep getting the last good copy
- **AND** an admin can see that the refresh was refused, and why

### Requirement: An app says what settings and secrets it needs

An app SHALL declare the settings and secrets it needs. An admin SHALL be able to see
which required ones are missing. A secret's value SHALL never be shown, stored or
written to any log.

#### Scenario: A missing setting is explained, not mistaken for a fault

- **WHEN** an app is installed before its required setting has been filled in
- **THEN** the app tells its readers it is not set up yet, instead of reporting an
  outage

### Requirement: Content from outside sites only where the app declared it

An app MAY show content from an outside site only if it declared that site. Featherbase
SHALL allow that site on that app's pages and nowhere else.

#### Scenario: A declared report site shows only in its own app

- **WHEN** an app that declared an outside report site is opened
- **THEN** the embedded report shows inside that app
- **AND** the same site cannot be embedded on any other Featherbase page

### Requirement: Deploying never silently takes an installed app away

A new release of Featherbase SHALL refuse to start when it lacks the exact version of
an installed, enabled app. Until someone deals with that, the running release SHALL keep
serving.

#### Scenario: A release that forgot an installed app's version

- **WHEN** a release is deployed without the version of an app that is installed and
  enabled
- **THEN** the release refuses to start
- **AND** people keep using the app on the release already running
