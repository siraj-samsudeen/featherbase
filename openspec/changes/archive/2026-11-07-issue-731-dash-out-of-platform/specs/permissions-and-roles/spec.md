# Permissions and Roles

## MODIFIED Requirements

### Requirement: The screen shows only what a person can use

After signing in, a person SHALL see only the tools they can use, decided by
the server from their current roles and grants.

#### Normative details for the whole requirement

Someone whose only access is
an app with pages of its own SHALL be taken to that app when they sign in, and
SHALL meet no administration menu and no request they would be refused. Someone with no
role of use at all SHALL get a plain page saying they have no access yet and
to ask their administrator, with sign-out; until they are given a role they
cannot manage their own sign-in methods. Building tables and importing data
SHALL be offered only to System Managers, as are changing a table's columns and
merging tables; the New button on a table's list is offered only where the
person may create rows. Access tokens stay available to everyone in the administration,
because they are self-service. A table list SHALL name only the tables the
person can read. A grant given to everyone (the built-in All role, which apps
use for their own tables) makes its table appear in lists but does not by itself
open the administration to someone. Someone with no grant of their own, only a row shared
with them, SHALL be told how such rows reach them rather than shown an empty
screen.

#### Scenario: A report-only person never meets the administration menu

- **WHEN** someone whose only role opens one app signs in on an
  administration address
- **THEN** they are taken to that app, and no administration menu or refused
  request appears

#### Scenario: A person with no access is told so

- **WHEN** someone with no roles of use signs in
- **THEN** they see that they have no access yet, who to ask, and a way to
  sign out

#### Scenario: A management address typed by someone else

- **WHEN** someone who is not a System Manager types the address for building
  a table, importing data, editing columns or merging
- **THEN** they land on the administration home instead
