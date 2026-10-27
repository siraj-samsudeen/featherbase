## ADDED Requirements

### Requirement: Using an app does not open the administration

Being able to read an installed app's own tables, or a row of one shared with
them, SHALL NOT by itself open the administration to a person, whether the app is
switched on or off. They reach those tables through the app, which keeps working
for them as before; only a grant on the instance's own tables, or being a System
Manager, opens the administration.

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
