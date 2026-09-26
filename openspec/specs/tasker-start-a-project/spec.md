# Start a Project

## Purpose

A project is a named, shared group of tasks. The user can start one with just a
name and list its tasks straight away, without filling in anything else first.

## Requirements

### Requirement: Start a project with just a name

A name SHALL be all it takes to create a project. A project with no tasks yet is
fine. The new project opens straight away, ready for its first task.

#### Scenario: Create an empty project

- **WHEN** the user creates a project called "Warehouse review"
- **THEN** "Warehouse review" opens, empty and ready for a task to be typed in

### Requirement: Add tasks to a project quickly

Inside a project, typing a title and pressing Enter SHALL add a task to that
project, and the box is left ready for the next one. New project tasks start
with nobody responsible, so the team can decide later who takes each one.

#### Scenario: List several tasks in a row

- **WHEN** the user, inside "Warehouse review", types three titles, pressing Enter after each
- **THEN** all three appear in "Warehouse review" with nobody responsible
- **AND** no form opens between them

### Requirement: One place to see and start projects

The Projects page SHALL list every project with how many tasks it holds, and it
is where new projects are started. Choosing a project opens its tasks. Opening
one of those tasks keeps the project selected behind the task details.

#### Scenario: See all projects before choosing

- **WHEN** "Warehouse review" has three tasks, "Store opening" has one, and the user opens the Projects page
- **THEN** both projects are listed, with three and one tasks
- **AND** a new project can be started from the same page

#### Scenario: Task details keep the project in view

- **WHEN** the user opens "Warehouse review" from the Projects page and then opens one of its tasks
- **THEN** the task details open
- **AND** "Warehouse review" is still the selected project behind them
