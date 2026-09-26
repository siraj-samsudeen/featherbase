## ADDED Requirements

### Requirement: Process the Inbox one task at a time

The user SHALL be able to go through the Inbox one task at a time, seeing how
many tasks are left. For each task they either place it and move on to the
next, or skip it, leaving it unchanged in the Inbox, and move on to the next.

#### Scenario: Place a task and move on

- **WHEN** the user is going through an Inbox of three tasks one at a time and places the first one in "Warehouse review"
- **THEN** that task leaves the Inbox
- **AND** the next task opens, with two left

#### Scenario: Skip a task you cannot decide yet

- **WHEN** the user is going through the Inbox one at a time and skips the current task
- **THEN** that task stays in the Inbox, unchanged
- **AND** the next task opens
