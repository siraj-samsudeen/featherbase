# Process Inbox

## MODIFIED Requirements

### Requirement: What the Inbox holds

The Inbox SHALL hold the user's own privately captured tasks awaiting organisation, never another person's tasks.

#### Scenario: A new task waits in the Inbox

- **WHEN** the user and a teammate each capture a task privately
- **THEN** the user's Inbox shows only the user's task

### Requirement: A task lives in one place

A task SHALL live in its creator's private Inbox or personal list, or in a shared project. Moving private work into a project SHALL remove it from its private list and permanently share it.

#### Scenario: Move a task to a project

- **WHEN** the user moves an Inbox task into "Warehouse review"
- **THEN** it appears in that shared project and leaves the private Inbox

### Requirement: A personal list decides who is responsible

A personal list SHALL belong only to its creator, who is responsible for its tasks. A private task SHALL NOT be assigned to another person before it is shared.

#### Scenario: Put a task on someone's list

- **WHEN** the user places their captured task on their personal list
- **THEN** the task remains creator-only and the user is responsible for it

#### Scenario: Assign private work to someone else

- **WHEN** the user attempts to assign their private task to a teammate
- **THEN** the assignment is refused and they are told to share the task first

#### Scenario: Take a task off someone's list

- **WHEN** the user moves a task from their personal list into a shared project
- **THEN** it leaves the personal list and becomes shared project work
- **AND** the former personal-list assignment is cleared, ready for team assignment
