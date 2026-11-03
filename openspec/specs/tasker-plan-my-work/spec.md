# Plan My Work

## Purpose

Each person can pick tasks from anywhere into My Focus, a private and ordered
shortlist, and see it together with everything they are responsible for in My
Work. Picking a task does not make them responsible for it or change it for
anyone else.

## Requirements

### Requirement: My Focus is private and ordered

Each person SHALL have their own My Focus. They can star any task into it,
whether or not they are responsible for it, unstar it, and change the order. The
list and its order follow them across reloads and devices, and nobody else sees
it.

#### Scenario: Build a daily shortlist

- **WHEN** Siraj stars a task he is responsible for and a task nobody has taken, then moves the second one to the top
- **THEN** after a reload both are in his My Focus in that order
- **AND** Shahul's My Focus is unchanged

### Requirement: My Work shows each task once

Among the user's tasks, My Work SHALL show their private shortlist first, followed by other tasks they are responsible for. A task in both groups SHALL appear only once, in the shortlist; conversations needing attention are shown before these task groups.

#### Scenario: A focused task I am responsible for

- **WHEN** the user stars a task they are already responsible for
- **THEN** the task appears once in their shortlist, not again in other assigned work

### Requirement: Focusing never changes the task

Starring, unstarring or reordering My Focus SHALL change only the user's own
list, never the task's place, responsible person, state, urgency or anything
else the team sees.

#### Scenario: Focus on someone else's work

- **WHEN** the user stars a project task that nobody is responsible for
- **THEN** it is in the user's My Focus
- **AND** for everyone it is still unassigned and in the same project

### Requirement: Missing tasks drop out of My Focus

If a task in My Focus is deleted or can no longer be opened, My Work SHALL still
load and leave that task out, keeping the rest in order.

#### Scenario: A focused task is deleted

- **WHEN** the middle task of the user's three focused tasks is deleted
- **THEN** My Work opens with the other two focused tasks, in their original order

### Requirement: Start with work needing attention

Opening Tasker without a specific destination SHALL open the user's work, with conversations needing their reply or review first, followed by their private shortlist and other assigned work. Explicit links to tasks and projects SHALL keep their intended destination.

#### Scenario: Start the day

- **WHEN** the user opens Tasker with one question addressed to them and a reply to their own question
- **THEN** both conversations are shown before their task lists
- **AND** their shortlist comes before the other tasks assigned to them

#### Scenario: Follow a task link

- **WHEN** the user follows a link to a task they can access
- **THEN** that task opens instead of the default workspace

### Requirement: Tasker follows the shared theme

Tasker's work area, sidebar and shared bar SHALL follow the selected light, dark or device theme using the Shop Floor palette. Changing theme SHALL retain the user's current work and unsaved capture.

#### Scenario: Change theme while capturing work

- **WHEN** the user types a private capture and switches between light and dark
- **THEN** the work area and navigation follow the selected theme
- **AND** the capture draft remains unchanged
