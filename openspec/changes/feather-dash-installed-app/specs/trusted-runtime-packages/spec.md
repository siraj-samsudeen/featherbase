## ADDED Requirements

### Requirement: An instance brings its own report to an app

An app SHALL be able to accept a report definition from the instance it is installed
on, so the same app serves different clients' data without changing the app.
Featherbase SHALL refresh that report on a schedule and serve each reader only the part
their own access allows.

#### Scenario: Two clients use the same report app

- **WHEN** two instances install the same report app, each with its own report
  definition
- **THEN** each instance's readers see their own instance's report, and neither app
  copy was changed

### Requirement: A failed refresh never replaces the last good copy

A scheduled refresh of an app's report data that fails or looks incomplete SHALL never
replace the last good copy, and an admin SHALL be able to see why it was refused.

#### Scenario: A half-finished refresh is never served

- **WHEN** a scheduled refresh comes back far smaller than the last good copy
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

### Requirement: An app can add a control to the top bar by declaring it

An app SHALL be able to add a control, such as a picker, to the shared top bar by
declaring it. Featherbase SHALL draw the control itself, and the control SHALL offer
only choices the reader is allowed.

#### Scenario: A store picker in the bar

- **WHEN** a manager responsible for two stores opens an app that declared a store
  picker
- **THEN** the top bar offers exactly their two stores

### Requirement: An app states the platform version it was built for

Every app SHALL state the platform version it was built for. Featherbase SHALL keep
running an app on any supported platform version, and SHALL warn before support for
that version ends.

#### Scenario: An older app keeps working after a platform release

- **WHEN** Featherbase is upgraded and an installed app was built for an earlier,
  still supported platform version
- **THEN** the app keeps working as before

#### Scenario: An app built for an unsupported platform version is refused

- **WHEN** an app's manifest names a platform version this Featherbase does not
  support, or its server module names a different one from its manifest
- **THEN** the app is not loaded
- **AND** the refusal names both versions

### Requirement: Deploying never silently takes an installed app away

A new release of Featherbase SHALL refuse to start when it lacks the exact version of
an installed, enabled app. Until someone deals with that, the running release SHALL keep
serving.

#### Scenario: A release that forgot an installed app's version

- **WHEN** a release is deployed without the version of an app that is installed and
  enabled
- **THEN** the release refuses to start
- **AND** people keep using the app on the release already running

### Requirement: An app can provide people's scope

An app SHALL be able to declare that it works out which places each person is
responsible for, so other apps on the instance can rely on that answer. It SHALL read
only the records it declared, and only records marked as deciding scope.

#### Scenario: A report app relies on a roster app

- **WHEN** a roster app that provides people's scope and a report app are installed
  together
- **THEN** the report shows each manager only the stores the roster app says they cover

#### Scenario: A roster app reaching beyond what it declared

- **WHEN** an app that provides people's scope tries to read records it did not
  declare, or records not marked as deciding scope
- **THEN** no one gets a scope from it, and requests are refused

### Requirement: Only one app provides people's scope

An instance SHALL have at most one enabled app that provides people's scope.
Featherbase SHALL refuse to install, enable or upgrade into a second one, and a release
SHALL refuse to start on an instance that has two.

#### Scenario: A second roster app is refused

- **WHEN** an admin installs a second app that provides people's scope
- **THEN** the install is refused, naming the app that already provides it

