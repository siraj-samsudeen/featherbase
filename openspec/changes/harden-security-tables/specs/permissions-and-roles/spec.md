## ADDED Requirements

### Requirement: Only a System Manager changes who can do what

The tables that decide access — permissions, roles, role holdings, data
scopes, shares, sign-in methods, identifier systems, installed apps, and the
tables that decide whose sales targets a person sees — and the tables that
make the system act on others' rows (server scripts, workflows, assignment
rules) SHALL refuse every write
from anyone but a System Manager, whatever grants exist on them. Reading them
SHALL stay governed by ordinary grants. A person's roles and whether their
account is enabled SHALL likewise change only for a System Manager, through
every way a row can be saved; values sent back unchanged SHALL NOT block an
ordinary edit. Role rows count as unchanged only when each stored row comes
back once, under its own id, with its own values; their order does not
matter. A save that names the same child row twice SHALL be refused, for
anyone. The check SHALL judge the row as it will be written, after
every save hook and script has run. A workflow or assignment rule SHALL NOT
target an access-control table or a person's roles or enabled flag, neither
when it is saved nor when it acts. Deleting a person, which a delete grant
allows, SHALL drop their roles with them; a person created afresh starts
enabled with no roles.

#### Scenario: A grant on the permission table does not let a user write it

- **WHEN** a user whose role is granted full access to the permission table
  tries to add a permission row
- **THEN** the save is refused

#### Scenario: Editing people does not include their roles

- **WHEN** a user allowed to edit people tries to give someone a role, or to
  disable or enable an account
- **THEN** the save is refused and the person is unchanged

#### Scenario: A save script cannot slip a role in

- **WHEN** a script that runs on every person save adds a role, and a user
  allowed to edit people saves someone's name
- **THEN** the save is refused

#### Scenario: A workflow cannot switch accounts off

- **WHEN** a System Manager saves a workflow whose state is a person's enabled
  flag
- **THEN** the save is refused

#### Scenario: An ordinary edit still saves

- **WHEN** that user edits a person's name and the form sends back the same
  roles and enabled flag
- **THEN** the edit saves

#### Scenario: Reusing a role row's id does not remove a role

- **WHEN** that user saves a person holding two roles and sends both role
  values under one of the two row ids
- **THEN** the save is refused and the person keeps both roles

### Requirement: A release refuses an open access configuration

A release SHALL stop before migrating when any permission row gives every
signed-in user or a guest any access to people or to an access-control table
(wherever the database still keeps that table before migrating),
when any sign-in method creates a new person for anyone it admits outside
development or test, or when
a sign-in method that creates people admits any address or a consumer email
domain.

#### Scenario: Everyone can read people

- **WHEN** a release runs against a database where every signed-in user is
  granted read on people
- **THEN** the release stops, naming that permission row

#### Scenario: Open sign-up in production

- **WHEN** a production release finds password sign-in set to create new people
- **THEN** the release stops and says to set it to refuse
