## Purpose

Break a task into smaller pieces of work while keeping responsibility, discussion and progress close to the overall task.

## ADDED Requirements

### Requirement: Subtasks are work in their own right

The user SHALL add subtasks with a title and give each its own responsible person, status and discussion. Subtasks SHALL appear together under their parent with progress, and SHALL NOT contain another level of subtasks.

#### Scenario: Divide the monthly review

- **WHEN** the user adds collecting figures and explaining differences under the monthly review and assigns them to different members
- **THEN** each member can update and discuss their subtask independently
- **AND** progress remains visible on the monthly review

### Requirement: Subtasks inherit privacy

A subtask SHALL have the same visibility as its parent. Private subtasks SHALL remain creator-only and cannot be assigned to someone else until the parent is shared.

#### Scenario: Share a parent

- **WHEN** the user moves their private parent task into a shared project
- **THEN** its subtasks and their discussion become shared with it

### Requirement: Finish the parent explicitly

A parent SHALL be marked Done only when every subtask is Done or Cancelled. Finishing the last subtask SHALL NOT automatically finish the parent.

#### Scenario: One subtask remains open

- **WHEN** the user tries to complete a parent with one subtask still In progress
- **THEN** completion is refused and the open work is identified

#### Scenario: All child work is settled

- **WHEN** every subtask is Done or Cancelled
- **THEN** the parent remains open until the user explicitly marks it Done
