# Task Details

## Purpose

Opening a task shows what is known about it, its discussion and the history of
its changes, at the level of detail the user wants and without leaving Tasker.

## Requirements

### Requirement: Choose how much detail to see

Task details SHALL open in one of three layouts: a short summary above the
list, a side panel beside the list, or a full page. The side panel is where
everyone starts. Switching layout keeps the same task open, and the chosen
layout is the user's own setting, remembered across reloads and devices.

#### Scenario: Switch layouts without losing the task

- **WHEN** the user opens a task in the side panel, switches to the full page and then to the summary
- **THEN** the same task stays open throughout
- **AND** after a reload, tasks open in the summary layout

### Requirement: Discussion and history stay in Tasker

In the side panel and full page, task details SHALL show the description, a
place to add a comment, and the task's comments and field changes in time
order, each with who made it and when. The summary layout shows the latest of
these. Ordinary discussion never requires leaving Tasker; attachments are still
handled in Featherbase's standard form for the task.

#### Scenario: See a comment and a change

- **WHEN** the user adds the comment "Called the supplier" and marks the task urgent
- **THEN** the task details show both, each with the user's name and the time

### Requirement: Task details keep your place

Opening a task's details SHALL NOT lose the user's place: closing them returns
the user to the same list or project, where they were.

#### Scenario: Open and close a project task

- **WHEN** the user has the project "Warehouse review" open, opens one of its tasks and closes it
- **THEN** "Warehouse review" is still open where the user left it
