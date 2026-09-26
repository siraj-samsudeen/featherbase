# Responsibility and Progress

## Purpose

Each task says who is responsible for it, how far along it is, and whether it is
urgent. These are separate signals, so changing one never quietly changes
another.

## Requirements

### Requirement: At most one responsible person

The responsible person is the one teammate who has taken on a task. A task SHALL
have at most one. Any team member can give a task to someone, hand it on to
someone else, or take a task nobody has taken. Creating a task does not make its
creator responsible. Changing who is responsible never changes the task's state,
and changing the state never changes who is responsible.

#### Scenario: Assign without starting

- **WHEN** the user gives a task that has not been started to Shahul
- **THEN** Shahul is responsible for it
- **AND** it is still Not started

#### Scenario: Hand a task on

- **WHEN** the user moves a task from Shahul to Siraj
- **THEN** Siraj is responsible for it and Shahul no longer is

### Requirement: Ticking done can be undone

A task's state is one of Not started, In progress, Blocked, On hold, Done and
Cancelled. Ticking a task SHALL mark it Done, and unticking it SHALL put it back
in the state it had just before, so an accidental tick loses nothing. Only Done
tasks show as ticked: choosing Done from the list of states ticks the task too,
and a Cancelled task is not ticked. Every other state is chosen on purpose.

#### Scenario: Undo an accidental tick

- **WHEN** the user ticks an In progress task and then unticks it
- **THEN** it is In progress again, not Not started

#### Scenario: Cancelled is not done

- **WHEN** the user sets a task to Cancelled
- **THEN** the task is not ticked

### Requirement: Explain why work has stopped

A task's description holds the current understanding of it; comments add dated
discussion underneath. When the user sets a task to Blocked, On hold or
Cancelled from a task list, Tasker SHALL offer a place to say why, without
requiring it. A saved explanation is added as a dated comment and does not
replace the description.

#### Scenario: Say why a task is on hold

- **WHEN** the user sets a task in a list to On hold and writes "Waiting for warehouse count"
- **THEN** the task is On hold
- **AND** "Waiting for warehouse count" appears as a dated comment, with the description unchanged

#### Scenario: Skip the explanation

- **WHEN** the user sets a task in a list to Blocked and skips the explanation
- **THEN** the task is Blocked and no comment is added

### Requirement: Urgent is one shared flag

A task SHALL be either urgent or not, and everyone on the team sees the same
flag. Marking a task urgent, or turning urgency off again, does not change who
is responsible for it or anyone's My Focus (each person's private shortlist).

#### Scenario: Everyone sees the same urgency

- **WHEN** Siraj marks a task urgent
- **THEN** Shahul also sees it as urgent
- **AND** neither person's My Focus changes
