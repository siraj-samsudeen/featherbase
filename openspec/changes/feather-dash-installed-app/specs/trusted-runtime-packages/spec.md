## ADDED Requirements

### Requirement: An app keeps a fast copy of its report data

An app SHALL be able to declare the report data it reads: which of the instance's
data sources it comes from, the question it asks of that source, and which of its
columns follow a person's places. Featherbase SHALL keep a copy of that data
(a cached copy), refresh it on a schedule, and hand each reader only their own part.

#### Scenario: A report opens from the cached copy

- **WHEN** a Team Leader opens a sales report whose data was refreshed this morning
- **THEN** they see their own section's figures at once, from this morning's copy
- **AND** they never see another section's figures

### Requirement: Cached and live figures always agree in form

An app SHALL be able to ask for the same report data live from its source. The live
answer SHALL be limited to the same places and laid out exactly as the cached one, so
the two can only differ where the data itself has changed.

#### Scenario: Switching to live figures

- **WHEN** a reader asks for live figures after reading the cached copy, and nothing
  has changed at the source
- **THEN** the live figures match the cached ones, row for row and in every total

### Requirement: Report data leaves only through a reader's own scope

A cached copy holds every place's figures, so Featherbase SHALL let it out only
through an app's read, limited to the reader's places. A reader with no places SHALL
get no figures. An app SHALL be able to narrow a read only by the columns it declared
for that.

#### Scenario: A cached copy cannot be exported

- **WHEN** an administrator looks for the cached copy among the instance's tables or
  in an export
- **THEN** it is not there to find

#### Scenario: Two neighbouring account numbers

- **WHEN** two readers each cover one of two very long account numbers that differ
  only in the last digit
- **THEN** each sees only their own account, cached and live

#### Scenario: A place the report cannot split by

- **WHEN** a person's place is a floor, and the report has no floor column
- **THEN** that place adds no figures, rather than the whole store's

### Requirement: A failed refresh never replaces the last good copy

A scheduled refresh of an app's report data that fails or looks incomplete SHALL never
replace the last good copy, and an admin SHALL be able to see why it was refused.

#### Scenario: A half-finished refresh is never served

- **WHEN** a scheduled refresh comes back far smaller than the last good copy
- **THEN** readers keep getting the last good copy
- **AND** an admin can see that the refresh was refused, and why

### Requirement: An app says what settings and secrets it needs

An app SHALL declare the settings, secrets and data sources it needs. An admin SHALL be
able to see which required ones are missing. A secret's value SHALL never be shown,
stored or written to any log.

#### Scenario: A missing setting is explained, not mistaken for a fault

- **WHEN** an app is installed before its required setting has been filled in
- **THEN** the app tells its readers it is not set up yet, instead of reporting an
  outage

#### Scenario: An admin sees what an app still needs

- **WHEN** an installed app still lacks a secret or a data source it requires
- **THEN** the instance's health page and the release log name the app and what is
  missing, without showing any value

### Requirement: An app gets only the settings it declared

An app SHALL receive only the settings and secrets it declared. A value kept for
anything else SHALL never reach it.

#### Scenario: A leftover value stays out of the app

- **WHEN** an instance still holds a value for a setting the app no longer declares
- **THEN** the app does not receive it, and an admin cannot add one for it

### Requirement: An instance sets an app's settings in its settings file

An instance SHALL set each app's settings in its own settings file, the same way as
its other settings: previewed before applying, kept in the file's history, and
read-only in Admin once the file sets them.

#### Scenario: Pointing dev at a different report

- **WHEN** the dev section of the instance's settings file names a different report
  for an app, and the owner applies the file to dev
- **THEN** the app on dev reads that report, and prod keeps its own

### Requirement: An app's secret never leaves the server

Featherbase SHALL never pass an app's secret on: not in an answer, an error, a log
line, the Access Log, or a settings export, even when the app's own code tries to.

#### Scenario: An app tries to answer with its secret

- **WHEN** an app's answer, or an error it raises, contains its secret
- **THEN** the reader gets a message that the answer was withheld, and the secret
  appears in no log

### Requirement: Content from outside sites only where the app declared it

An app MAY show content from an outside site only if it declared that site. Featherbase
SHALL allow that site on that app's pages and nowhere else.

#### Scenario: A declared report site shows only in its own app

- **WHEN** an app that declared an outside report site is opened
- **THEN** the embedded report shows inside that app
- **AND** the same site cannot be embedded on any other Featherbase page

#### Scenario: A loosely written outside site is refused

- **WHEN** an app declares an outside site as any site under a domain, or names a
  page rather than the site itself
- **THEN** the app is not loaded, and the refusal says how to write the site

### Requirement: An app can add a control to the top bar by declaring it

An app SHALL be able to add a control, such as a picker, to the shared top bar by
declaring it. Featherbase SHALL draw the control itself, and the control SHALL offer
only choices the reader is allowed.

#### Scenario: A store picker in the bar

- **WHEN** a manager responsible for two stores opens an app that declared a store
  picker
- **THEN** the top bar offers exactly their two stores

#### Scenario: No picker for someone with nothing to choose

- **WHEN** a person responsible for no store opens an app that declared a store
  picker
- **THEN** the top bar shows no store picker

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

#### Scenario: A switched-off app does not hold up a release

- **WHEN** a release is deployed without the version of an app that is installed but
  switched off
- **THEN** the release goes ahead

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


### Requirement: A slow outside call never holds up other people's work

When an app's read asks an outside service, Featherbase SHALL decide who may see what
first, and then let the app make the call with nothing in the instance held waiting
for it.

#### Scenario: The warehouse is slow

- **WHEN** a reader opens live figures and the warehouse takes half a minute to answer
- **THEN** other people saving records meanwhile, and an administrator turning an
  app off, are not kept waiting by that read

#### Scenario: An app turned off while it waits

- **WHEN** an administrator turns an app off while one of its reads waits on the
  warehouse
- **THEN** that read's answer is refused, and no view of it is recorded

### Requirement: Every view of a report is recorded

An app SHALL be able to record that a person viewed a report. Featherbase SHALL write
the record itself, saying who looked, at which places, and whether they saw the
cached copy or live figures.

#### Scenario: Tracing a disputed figure

- **WHEN** a manager says a figure they saw yesterday was wrong
- **THEN** an administrator can find their view, and the exact cached copy it came
  from
