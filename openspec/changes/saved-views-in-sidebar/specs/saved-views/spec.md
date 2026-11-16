## ADDED Requirements

### Requirement: Saved views are in the Admin sidebar

The Admin sidebar SHALL list, under "Saved views", the user's own saved views on every table and the shared views of others that the user starred. Only views on tables the user can read now SHALL be listed. Choosing one SHALL open its table's list with the view's filters. A shared view of someone else SHALL offer a star on the list to add it to the sidebar or remove it; the user's own views need none. With nothing to list, the group SHALL NOT be shown.

#### Scenario: Find a saved view from the sidebar

- **GIVEN** the user saved the view "ATK Departments" on Department
- **WHEN** the user chooses "ATK Departments" in the sidebar's Saved views
- **THEN** the Department list opens with that view's filters

#### Scenario: Star a colleague's shared view

- **GIVEN** a colleague shared the view "ATK Departments" on Department, which the user can read
- **WHEN** the user stars it on the Department list
- **THEN** it appears in the user's sidebar, marked as shared
- **AND** unstarring it takes it out

#### Scenario: Nothing the user cannot read

- **GIVEN** the user starred a shared view on a table they cannot read, or one later made private or deleted
- **WHEN** the sidebar lists the user's saved views
- **THEN** that view is not listed
