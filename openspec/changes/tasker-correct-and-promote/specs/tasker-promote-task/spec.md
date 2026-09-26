# Promote a Task

## Purpose

When a task turns out to be a bigger piece of work, the user can turn it into a
project in one step, without losing anything the team has already recorded
about it.

## ADDED Requirements

### Requirement: Turn a task into a project

Promoting a task SHALL create a project named after the task, carrying over its
description. A task nobody has worked on yet simply becomes the project; one
with work history, such as someone responsible or comments, is instead kept as
the new project's first task, so nothing is lost. Tasker explains this and asks
first, and cancelling changes nothing.

#### Scenario: Promote a fresh task

- **WHEN** the user promotes a task "Plan the store opening" that has a description and has not been touched since it was captured
- **THEN** a project "Plan the store opening" with the same description opens
- **AND** the task is gone, without any question asked

#### Scenario: Promote a task with history

- **WHEN** a task was given to Shahul and later handed back to nobody, and the user promotes it
- **THEN** Tasker explains that the task will be kept inside the new project and asks first
- **AND** on confirming, the new project's first task is the original task with its history

### Requirement: Promotion is all or nothing

Promotion SHALL either finish completely or change nothing — never a
half-made project or a lost task — and only for someone allowed to change
both. Retrying after a lost answer gives the same result, not a second
project, and a task that changes mid-promotion is refused or re-asked rather
than losing the new work.

#### Scenario: Retrying does not duplicate

- **WHEN** the user promotes a task, the connection drops before the answer arrives, and the user retries
- **THEN** there is exactly one new project

#### Scenario: New work is not lost

- **WHEN** Shahul comments on a fresh task while the user is promoting it
- **THEN** Tasker does not delete the task and its comment
- **AND** it either refuses or asks the user to keep the task inside the new project
