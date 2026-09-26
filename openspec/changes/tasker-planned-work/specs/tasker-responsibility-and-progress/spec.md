## ADDED Requirements

### Requirement: Explain why work has stopped, from task details

When the user sets a task to Blocked, On hold or Cancelled from its details,
Tasker SHALL offer a place to say why, without requiring it, just as task lists
do. A saved explanation is added as a dated comment and does not replace the
description.

#### Scenario: Say why from the task's details

- **WHEN** the user opens a task, sets it to Blocked and writes "Supplier has not replied"
- **THEN** the task is Blocked
- **AND** "Supplier has not replied" appears as a dated comment
