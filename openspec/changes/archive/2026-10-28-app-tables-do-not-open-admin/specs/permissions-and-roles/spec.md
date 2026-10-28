## ADDED Requirements

### Requirement: Using an app does not open the administration

An installed app's tables SHALL NOT count towards the administration only when
that app opens at its own root, with pages of its own, whether it is switched on
or off. Reading such an app's tables, or a row of one shared with them, does not
by itself open the administration to a person: they reach those tables through
the app, which keeps working for them as before, and signing in takes them to it.
An app without pages of its own is used through the administration, so its
tables still count, as do grants on the instance's own tables.

#### Scenario: A store manager who only uses Feather Dash

- **WHEN** a store manager whose only grant is to read Feather Dash's own tables
  opens Feather Dash
- **THEN** Feather Dash opens with their figures, and nothing offers them the
  administration
- **AND** if they type an administration address, they are told they have no
  access there

#### Scenario: A manager who also reads an instance table

- **WHEN** the same manager is also given a grant to read one of the instance's
  own tables
- **THEN** they can open the administration, where Feather Dash's tables are
  listed beside that one

#### Scenario: A clerk of an app without pages of its own

- **WHEN** a clerk whose only grant is on the tables of an installed app that
  has no pages of its own signs in
- **THEN** they can open the administration and use that app's tables there,
  as before
