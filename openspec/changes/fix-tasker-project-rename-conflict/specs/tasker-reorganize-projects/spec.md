## MODIFIED Requirements

### Requirement: Rename a project

Any team member SHALL be able to rename a project without moving its tasks, with the new name shown everywhere the project appears. If someone else changed the project after the user started renaming it, the rename SHALL be refused with an explanation while keeping the user's unsaved name, even if the project refreshed during editing.

#### Scenario: Rename keeps the tasks

- **WHEN** the user renames "September stock review" to "Stock review — September"
- **THEN** all of its tasks are still in it
- **AND** the new name shows in the user's project tabs and wherever a task can be moved to it

#### Scenario: A newer change wins

- **WHEN** the user starts renaming a project, Shahul renames it first, the project refreshes, and the user then saves
- **THEN** the user's rename is refused with an explanation that the project changed
- **AND** Shahul's name stays saved
- **AND** the user's unsaved name remains available to edit or cancel
