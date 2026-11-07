## ADDED Requirements

### Requirement: A System Manager can tell an installed app is closed to them

A System Manager's app switcher SHALL list each installed, enabled app they can't open, greyed out so it can't be chosen, naming the roles that would open it. Anyone else's list SHALL hold only the apps they can open, and they SHALL be refused the list of closed apps. This SHALL NOT change who can open an app.

#### Scenario: A System Manager without the app's role

- **WHEN** a System Manager without the Tasker Member role opens the switcher on an instance with Tasker installed
- **THEN** Tasker is listed as "Tasker: you need the Tasker Member role" and can't be chosen

#### Scenario: Someone who isn't a System Manager

- **WHEN** a person who isn't a System Manager opens the switcher
- **THEN** an app they can't open isn't listed
