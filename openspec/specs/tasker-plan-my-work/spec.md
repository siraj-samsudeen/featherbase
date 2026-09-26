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

My Work SHALL show the user's My Focus first, then the other tasks they are
responsible for. A task that belongs in both parts appears only once, in My
Focus.

#### Scenario: A focused task I am responsible for

- **WHEN** the user stars a task they are already responsible for
- **THEN** My Work lists it once, in the My Focus part

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
