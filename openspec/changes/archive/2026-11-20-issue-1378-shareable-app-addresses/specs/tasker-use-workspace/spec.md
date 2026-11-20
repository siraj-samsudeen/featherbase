## ADDED Requirements

### Requirement: The address names what is open
Tasker's address SHALL name the page, the project or saved view or issue, the task and the subtask that are open, and SHALL change as the user moves, so that the address opened again (copied, shared or reloaded) shows the same thing and Back returns to the previous one. A subtask's address SHALL name its parent task.

#### Scenario: A shared subtask address reopens it

- **WHEN** the user opens the project "Shelf reset", its task "Reset aisle 4" and that task's subtask "Move the cereal bay", and a teammate opens the address the user copied
- **THEN** the teammate sees the project "Shelf reset" with the subtask "Move the cereal bay" open

#### Scenario: Back returns to the list

- **WHEN** the user opens a task from the Inbox and presses Back
- **THEN** the Inbox shows with no task open
