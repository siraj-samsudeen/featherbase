## MODIFIED Requirements

### Requirement: A System Manager can tell an installed app is closed to them

A System Manager SHALL see, on Admin → Apps, the roles that open each installed app ("Opens for: Tasker Member"). Everyone's app switcher, a System Manager's included, SHALL list only the apps they can open. Anyone who isn't a System Manager SHALL be refused the list of closed apps. This SHALL NOT change who can open an app.

#### Scenario: A System Manager without the app's role

- **WHEN** a System Manager without the Tasker Member role opens Admin → Apps on an instance with Tasker installed
- **THEN** Tasker's row says it opens for Tasker Member
- **AND** their app switcher does not list Tasker

#### Scenario: Someone who isn't a System Manager

- **WHEN** a person who isn't a System Manager opens the switcher
- **THEN** an app they can't open isn't listed
