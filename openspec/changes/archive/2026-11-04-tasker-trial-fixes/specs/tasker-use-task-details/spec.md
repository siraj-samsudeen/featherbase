# Task Details

## MODIFIED Requirements

### Requirement: Discussion and history stay in Tasker

In the side panel and full page, task details SHALL show the description, a
place to add a comment, and the task's comments and field changes in time
order, each with who made it and when. A change to who is responsible or to
the project SHALL name the person or project, never a record id. The summary
layout shows the latest of these. Ordinary discussion never requires leaving
Tasker; attachments are still handled in Featherbase's standard form for the
task.

#### Scenario: See a comment and a change

- **WHEN** the user adds the comment "Called the supplier" and marks the task urgent
- **THEN** the task details show both, each with the user's name and the time

#### Scenario: A change of responsibility names the person

- **WHEN** the user moves a task into the project "Data quality" and assigns it to Shahul
- **THEN** the history shows "Data quality" and "Shahul", not their record ids
