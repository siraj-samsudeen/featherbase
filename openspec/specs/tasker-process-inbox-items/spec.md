# Process Inbox

## Purpose

The Inbox holds tasks nobody has placed yet. The user moves each one to where it
belongs: a project (a named group of shared work) or one person's personal list
(the team-visible list of tasks that belong to that person).

## Requirements

### Requirement: What the Inbox holds

The Inbox SHALL show every task that is not in a project or on anyone's personal
list, and only those.

#### Scenario: A new task waits in the Inbox

- **WHEN** the user captures "Order packing tape" and opens the Inbox
- **THEN** "Order packing tape" is listed there

### Requirement: A task lives in one place

A task SHALL be in exactly one place: the Inbox, one project, or one person's
personal list.

#### Scenario: Move a task to a project

- **WHEN** the user moves an Inbox task into the project "Warehouse review"
- **THEN** it appears in "Warehouse review" and is no longer in the Inbox

### Requirement: A personal list decides who is responsible

Putting a task on someone's personal list SHALL make them responsible for it,
and taking it off their list also takes it off them.

#### Scenario: Put a task on someone's list

- **WHEN** the user moves a task from the Inbox to Shahul's personal list
- **THEN** Shahul is responsible for it

#### Scenario: Take a task off someone's list

- **WHEN** the user moves a task from Shahul's personal list to "Warehouse review"
- **THEN** it appears in "Warehouse review" and Shahul is no longer responsible for it
