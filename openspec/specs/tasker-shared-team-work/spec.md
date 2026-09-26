# Shared Team Work

## Purpose

Tasker is built for one small team whose members trust each other: everyone can
see and work on every project and task. Being responsible for a task shows who
is on it; it does not lock anyone else out.

## Requirements

### Requirement: Everyone can work on everything

Every signed-in team member SHALL be able to see, create and change every
project and task, whether or not they are responsible for it. Each person's own
settings, such as My Focus, starred projects and saved views, stay private to
them.

#### Scenario: Help with a task nobody has taken

- **WHEN** Shahul marks urgent a task nobody is responsible for and adds a comment to it
- **THEN** both changes are saved and everyone sees them
- **AND** nobody is responsible for the task yet

### Requirement: A newer change is never overwritten

If two people change the same task and one saves first, the other's save SHALL
be refused rather than silently overwriting the newer change.

#### Scenario: Two people edit the same task

- **WHEN** Siraj and Shahul both have the same task open, Shahul saves a change, and Siraj then saves his
- **THEN** Siraj is told the task has changed
- **AND** Shahul's change stays
