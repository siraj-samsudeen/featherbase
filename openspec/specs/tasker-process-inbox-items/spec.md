# Process Inbox

## Purpose

The Inbox holds tasks that nobody has placed yet. The user goes through it and
moves each task to where it belongs, either a project (a named group of shared
work) or one person's personal list, without disturbing anything else about the
task.

## Requirements

### Requirement: What the Inbox holds

The Inbox SHALL show every task that is neither in a project nor on anyone's
personal list, and only those tasks. Looking at the Inbox changes nothing about
them.

#### Scenario: A new task waits in the Inbox

- **WHEN** the user captures "Order packing tape" and opens the Inbox
- **THEN** "Order packing tape" is listed there
- **AND** it stays as it was until someone moves it

### Requirement: A task lives in one place

A task SHALL always be in exactly one place: the Inbox, one project, or one
person's personal list. Tasker refuses any change that would put a task in a
project and on a personal list at the same time. Moving a task to a project or
back to the Inbox leaves its responsible person and its state as they were.

#### Scenario: Move a task to a project

- **WHEN** the user moves an Inbox task that nobody is responsible for and that has not been started into the project "Warehouse review"
- **THEN** it leaves the Inbox and appears in "Warehouse review"
- **AND** nobody is responsible for it and it is still not started

#### Scenario: Moving takes it out of its old place

- **WHEN** the user moves a task from "Warehouse review" to Shahul's personal list
- **THEN** it appears on Shahul's personal list
- **AND** it is no longer in "Warehouse review"

### Requirement: A personal list makes its owner responsible

A personal list is the team-visible list of tasks that belong to one person.
Moving a task onto someone's personal list SHALL make that person responsible
for it. Its state and everything else about it stay the same.

#### Scenario: Move a task to someone's personal list

- **WHEN** the user moves an In progress task from the Inbox to Shahul's personal list
- **THEN** Shahul becomes responsible for it
- **AND** it is still In progress
