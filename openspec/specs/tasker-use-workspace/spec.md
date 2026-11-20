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
urgent and add it to My Focus. A Blocked, On hold or Cancelled task also shows
its latest comment under its title, so the reason it stopped is at hand.

#### Scenario: One row, everything at hand

- **WHEN** a Blocked, urgent task whose latest comment is "Waiting for supplier" appears in any list
- **THEN** its row offers all of those controls
- **AND** "Waiting for supplier" is shown with it

### Requirement: The address names what is open
Tasker's address SHALL name the page, the project or saved view or issue, the task and the subtask that are open, and SHALL change as the user moves, so that the address opened again (copied, shared or reloaded) shows the same thing and Back returns to the previous one. A subtask's address SHALL name its parent task.

#### Scenario: A shared subtask address reopens it

- **WHEN** the user opens the project "Shelf reset", its task "Reset aisle 4" and that task's subtask "Move the cereal bay", and a teammate opens the address the user copied
- **THEN** the teammate sees the project "Shelf reset" with the subtask "Move the cereal bay" open

#### Scenario: Back returns to the list

- **WHEN** the user opens a task from the Inbox and presses Back
- **THEN** the Inbox shows with no task open
