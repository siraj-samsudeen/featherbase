## ADDED Requirements

### Requirement: A System Manager links accounts to people from one screen

The Admin SHALL have a screen, for System Managers only, that lists the
MotherDuck Accounts used by people and not yet linked, with the people each
username reads as offered as choices. Choosing one SHALL link the account to
that person at once, and the choice can be undone. The screen SHALL also queue
the sync on request, so the tickets of linked accounts close without waiting for
the daily run.

#### Scenario: Linking a suggested person

- **WHEN** a System Manager opens the screen and picks one of an account's
  suggested people
- **THEN** the account is linked to that person, it leaves the accounts to link,
  and the next sync closes its ticket

#### Scenario: Someone who is not a System Manager

- **WHEN** someone who is not a System Manager asks for the screen's list
- **THEN** they are refused
