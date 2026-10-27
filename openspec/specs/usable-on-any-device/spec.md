# Usable on Any Device

## Purpose

Every Featherbase screen, in the Admin UI and in every installed app such as
Tasker, can be used on a phone or a desktop, with a mouse or a keyboard, by
people who can't rely on colour. Feature specs don't repeat these promises.

## Requirements

### Requirement: Works on a phone

Every screen SHALL work on a phone-sized screen without the page scrolling
sideways. Wide content, such as a table of rows, may scroll within its own area.

#### Scenario: Open a list on a phone

- **WHEN** the user opens a list of rows on a phone
- **THEN** the page fits the width of the screen
- **AND** a table too wide for it scrolls sideways on its own

### Requirement: Works by keyboard

Every control SHALL work by keyboard, and the user can always see which control
has focus.

#### Scenario: Use a screen without a mouse

- **WHEN** the user moves through a screen using only the keyboard
- **THEN** they can reach and use every control
- **AND** they can always see which control they are on

#### Scenario: Move past a closed panel

- **WHEN** the user moves through a phone screen while a panel is closed
- **THEN** focus skips the controls hidden inside it
- **AND** focus returns to those controls when the user opens the panel

#### Scenario: Use the same navigation on a desktop

- **WHEN** the user moves through a desktop screen using only the keyboard
- **THEN** they can reach the navigation controls that remain visible

### Requirement: Nothing shown by colour alone

No status or signal SHALL be shown by colour alone.

#### Scenario: Read a status without colour

- **WHEN** a row has a status, such as urgent or blocked
- **THEN** the status can be read in words or from a symbol, not only from its colour

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
