# Workspace

## Purpose

Tasker's workspace works the same way everywhere, so the user can move between
their lists, scan tasks and act on them on a desktop or a phone without
relearning anything.

## Requirements

### Requirement: The places to go stay in the same order

Tasker SHALL always offer the same places, in this order: Inbox (tasks not yet
placed), My Work (the user's focus and responsibilities), Together (the team's
active work by person), Personal tasks (each person's personal list), Views (the
user's private saved views) and Projects. Below Projects, every project is
listed by name with its number of tasks, and choosing one opens it.

#### Scenario: Go from the main places to a project

- **WHEN** Tasker has two projects and the user looks at the navigation
- **THEN** Inbox, My Work, Together, Personal tasks, Views and Projects appear in that order
- **AND** both projects are listed below Projects with their task counts, and choosing one opens its tasks

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
