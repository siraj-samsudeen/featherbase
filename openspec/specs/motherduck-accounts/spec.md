# MotherDuck Accounts

## Purpose

People read the MotherDuck data warehouse under their own MotherDuck usernames.
Featherbase keeps a record of every MotherDuck user, in step with MotherDuck's
own list, and says which person uses each one, so a username seen in the
warehouse can be looked up.

## Requirements

### Requirement: MotherDuck Accounts follow MotherDuck's own list

Featherbase SHALL keep one MotherDuck Account for every user MotherDuck lists,
brought in step every day. It only reads MotherDuck. An account SHALL be Active
while MotherDuck lists it and it can be used, Deprovisioned while MotherDuck
lists it but has switched it off, and Removed once MotherDuck no longer lists
it, with the day it went. An account is never deleted.

#### Scenario: A user switched off and a user gone

- **WHEN** MotherDuck switches one user off and stops listing another, and the
  daily sync runs
- **THEN** the first account reads Deprovisioned, the second reads Removed with
  that day, and both are still there

#### Scenario: MotherDuck will not list its users

- **WHEN** MotherDuck refuses to list its users to Featherbase
- **THEN** the sync changes nothing and says which permission to grant in
  MotherDuck

### Requirement: An account is linked to the person who uses it

When exactly one person has an account's email, the sync SHALL link the account
to that person. Every other account a person uses SHALL get one ticket asking
the MotherDuck reviewer to link it, naming the people whose names it reads as;
the ticket SHALL close itself once the account is linked. An account a program
uses gets no ticket.

#### Scenario: Linked by email

- **WHEN** an account's email is the email of exactly one person
- **THEN** the account is linked to that person, and no ticket is raised

#### Scenario: Linked by hand

- **WHEN** an account has no email that names one person
- **THEN** one ticket asks the reviewer to link it, and once someone sets its
  person, the next sync closes the ticket

### Requirement: The review tickets sit under one umbrella ticket

Every review ticket the sync raises SHALL sit under one umbrella ticket. The sync
SHALL resolve the umbrella when none of its tickets is open, and reopen that same
umbrella, never a second, when it raises a new one (#1397).

#### Scenario: One umbrella across runs

- **WHEN** the sync raises tickets on two runs, and every ticket was closed between them
- **THEN** all of them sit under the same umbrella ticket, which was resolved after the first run's tickets closed and reopened by the second run

### Requirement: Search finds an account by its username or email

Searching for a MotherDuck username or its email SHALL find the account, shown
by its username.

#### Scenario: A login from the warehouse

- **WHEN** the user searches for a username seen in the warehouse's query history
- **THEN** the MotherDuck Account appears, and its person is one click away

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
