## ADDED Requirements

### Requirement: Roles given to everyone who signs in

A System Manager SHALL be able to name, in System Settings, roles that every person holds without adding them to each Person. Only a System Manager SHALL change them, each SHALL be an existing role other than a platform role, and an instance settings file SHALL NOT carry them.

#### Scenario: A newcomer holds the role everyone holds

- **WHEN** System Settings gives "Tasker Member" to everyone who signs in and a person with no roles of their own signs in
- **THEN** they can do what Tasker Member may do

#### Scenario: Someone who signs in later holds it too, and a service account does not

- **WHEN** a person signs in for the first time after the setting names "Tasker Member"
- **THEN** they hold Tasker Member, and a service account still doesn't

#### Scenario: Removing the role takes it only from those who held it that way

- **WHEN** "Tasker Member" is removed from the setting
- **THEN** a person who held it only through the setting no longer holds it, and a person given it directly still does

#### Scenario: A platform role cannot be given to everyone

- **WHEN** a System Manager names System Manager in the setting
- **THEN** the save is refused with "System Manager cannot be given to everyone"

#### Scenario: A person's pages say where the role comes from

- **WHEN** a System Manager opens the access page or the Person form of someone holding a role only through the setting
- **THEN** the access page says "everyone who signs in holds it (System Settings)", and the Person form says "Everyone who signs in also holds Tasker Member, set in System Settings."
