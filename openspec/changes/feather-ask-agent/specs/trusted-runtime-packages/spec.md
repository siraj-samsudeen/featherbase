# Trusted Runtime Packages

## ADDED Requirements

### Requirement: An app can declare that a read looks across apps

An app SHALL be able to declare that one of its outbound reads (a read that calls out to a slow
service after its checks are done) uses Featherbase's agent tools: the lookups an outside AI
agent gets, such as listing Tables and finding rows. Only such a read SHALL be given them, and the
declaration SHALL be refused on any other read or action.

#### Scenario: A read that does not call out cannot declare it

- **GIVEN** an app whose read declares Featherbase's agent tools but does not call out
- **WHEN** an administrator installs the app
- **THEN** the installation is refused and says the read must call out

### Requirement: The app's lookups run as the person

Each lookup through Featherbase's agent tools SHALL run as the person using the app, seeing exactly
what they may read, in every app, and SHALL stop working once that person signs out, is signed
out everywhere, or is turned off.

#### Scenario: The app's lookup sees only Selvi's rows

- **GIVEN** an app with a read that declares the tools, and Selvi and Ravi, of whom only Selvi
  has a ticket
- **WHEN** Selvi and then Ravi use the read to find tickets
- **THEN** Selvi's lookup finds her ticket and Ravi's finds none

#### Scenario: Signing out everywhere stops the lookups

- **GIVEN** Selvi is using the app's read, and its lookups are under way
- **WHEN** Selvi signs out everywhere
- **THEN** the read's next lookup is refused

### Requirement: An app gets only the tools that read

An app's read SHALL be given only the agent tools that read, never one that adds, changes or
deletes.

#### Scenario: The app cannot add a row through the tools

- **GIVEN** an app with a read that declares the tools
- **WHEN** the read asks for the tool that adds a row
- **THEN** there is no such tool for it, and nothing is added
