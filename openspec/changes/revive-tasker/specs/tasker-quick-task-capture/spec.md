## MODIFIED Requirements

### Requirement: Quick task capture

Typing a title and pressing Enter SHALL capture a task in the user's private Inbox, ready for later organisation. Creating a task from within a shared project SHALL instead create it in that project with shared visibility.

#### Scenario: Capture a task

- **WHEN** the user captures "Prepare my notes" from their workspace
- **THEN** only the user can see it in their Inbox
- **AND** the capture box is ready for another task

#### Scenario: Capture within a project

- **WHEN** the user adds "Collect figures" inside a shared project
- **THEN** the task belongs to that project and is visible to its team
