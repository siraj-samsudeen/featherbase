## MODIFIED Requirements

### Requirement: Controls are clearly named

Every control SHALL be clearly named, by visible text or an obvious symbol such
as an arrow, and no two controls side by side SHALL share a name. A control
with no visible text, such as a checkbox, SHALL still have a name a screen
reader announces.

#### Scenario: Know what a button does

- **WHEN** a newcomer looks at a screen on a phone, where nothing can be hovered
- **THEN** they can tell what each button does

#### Scenario: Tell neighbouring controls apart

- **WHEN** the user looks at a Table's list, where one control chooses which
  columns the list shows and another opens the screen that edits the columns
- **THEN** the two have different names that say which is which

#### Scenario: A screen reader names every control

- **WHEN** a screen reader user moves through a Table's list, its row
  checkboxes and its filter pickers
- **THEN** each control is announced by name, and each row's checkbox names
  the row it selects
