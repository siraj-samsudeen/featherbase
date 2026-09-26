# Reorganize Projects

## Purpose

The team can fix a project's name after the fact, without recreating the project
or moving its tasks.

## Requirements

### Requirement: Rename a project

Any team member SHALL be able to rename a project. Its tasks stay with it, and
the new name shows everywhere the project appears. If someone else changed the
project after the user started renaming it, the rename is refused rather than
overwriting their change.

#### Scenario: Rename keeps the tasks

- **WHEN** the user renames "September stock review" to "Stock review — September"
- **THEN** all of its tasks are still in it
- **AND** the new name shows in the user's project tabs and wherever a task can be moved to it

#### Scenario: A newer change wins

- **WHEN** the user starts renaming a project, Shahul renames it first, and the user then saves
- **THEN** the user's rename is refused
- **AND** Shahul's name stays
