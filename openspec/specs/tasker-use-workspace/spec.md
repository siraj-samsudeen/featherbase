# Workspace

## Purpose

Tasker's workspace works the same way everywhere, so the user can move between
their lists, scan tasks and act on them on a desktop or a phone without
relearning anything.

## Requirements

### Requirement: Navigation is the same everywhere

Tasker SHALL offer the same places to go, in the same order, on every page, such
as the Inbox, My Work and each project, so the user never has to relearn where
things are.

#### Scenario: Open a project from anywhere

- **WHEN** the user is in the Inbox and chooses the project "Warehouse review" from the navigation
- **THEN** the project's tasks open, and the navigation looks the same as before

### Requirement: Every task row offers the same controls

Every list SHALL show tasks the same way. From each row the user can tick the
task done, change its state, its place and its responsible person, mark it
urgent and add it to My Focus. A Blocked or On hold task also shows its latest
explanation under its title.

#### Scenario: One row, everything at hand

- **WHEN** a Blocked, urgent task explained with "Waiting for supplier" appears in any list
- **THEN** its row offers all of those controls
- **AND** "Waiting for supplier" is shown with it

### Requirement: Works on a phone

Tasker SHALL be usable on a desktop and on a phone-sized screen without the page
scrolling sideways. On a phone, the Projects page stacks starting a project
above the list of projects, and the strip of project names scrolls sideways on
its own rather than squeezing the names.

#### Scenario: Projects on a phone

- **WHEN** the user opens the Projects page on a screen 375 pixels wide
- **THEN** starting a project sits above the list of projects and the page does not scroll sideways
- **AND** the strip of project names can be scrolled sideways

### Requirement: Easy to find your way and use by keyboard

Tasker SHALL keep navigation visibly separate from the work area and give each
main place its own icon. Every control SHALL have a visible label, work by
keyboard and show clearly when it has keyboard focus. No signal, such as state
or urgency, is shown by colour alone.

#### Scenario: Keyboard focus stays visible

- **WHEN** the user moves through the navigation and a task's controls using only the keyboard
- **THEN** the control that has focus is always clearly visible, without hovering the mouse
