# Find and Reuse a Task View

## Purpose

The user can narrow any task list by searching and filtering, always see what is
narrowing it, and save that setup as a private saved view to come back to. None
of this changes the tasks.

## Requirements

### Requirement: Search stays within the list

Search SHALL match words in task titles and descriptions, not in comments or
change history, and only among the tasks of the list being searched. Searching
a project never brings in tasks from other projects.

#### Scenario: Search a project

- **WHEN** one task in "September stock review" has "warehouse transfer" in its description, a task in another project is titled "Warehouse keys", and the user searches "September stock review" for "warehouse"
- **THEN** the task with "warehouse transfer" in its description is shown
- **AND** "Warehouse keys" is not

### Requirement: Filters combine predictably

Task lists SHALL filter by state, responsible person and urgency, and lists that
span several projects also filter by project. Choosing several values in one
filter shows tasks that match any of them. Using several filters, and search,
shows only tasks that match all of them.

#### Scenario: Several filters at once

- **WHEN** the user filters for Not started or In progress, for Shahul or Unassigned, and for urgent
- **THEN** an urgent In progress task of Shahul's is shown
- **AND** a task with the same state and person that is not urgent is not shown

### Requirement: See what is narrowing the list

Tasker SHALL show every search and filter in use, and how many tasks match, and
let the user remove each one.

#### Scenario: Nothing matches

- **WHEN** a project has 12 tasks and the user's filters match none of them
- **THEN** Tasker shows 0 of 12 tasks
- **AND** the user can clear the filters and see all 12 again

### Requirement: Saved views are private

A saved view is a named search and set of filters. The user SHALL be able to
save the current setup either for the list they are in, such as the current
project, or across all tasks. A saved view belongs to the user alone: it follows
them across devices, nobody else can see its name or contents, and opening,
renaming or deleting it never changes a task or project.

#### Scenario: Reopen a view on another device

- **WHEN** Shahul saves "Urgent work assigned to Shahul" across all tasks and later signs in on another device
- **THEN** the same view is there, with the same search and filters
- **AND** no task has changed and none of his teammates can see the view

#### Scenario: A project view stays in its project

- **WHEN** the user saves a view for "September stock review" and reopens it
- **THEN** it never shows tasks from "Store opening readiness", even ones that match its filters

### Requirement: A saved view changes only when the user saves it

Changing a saved view's search or filters SHALL leave the saved view as it was
until the user chooses to update it. The user can reset back to it.

#### Scenario: Reset a changed view

- **WHEN** the user opens a saved view of Blocked tasks, also ticks In progress, and then resets
- **THEN** the view shows Blocked tasks only, and the saved view is unchanged

### Requirement: A missing project never widens a view

If a saved view's project or person no longer exists, Tasker SHALL say so and
keep that filter rather than show more tasks.

#### Scenario: A deleted project

- **WHEN** a saved view filters on a project that has since been deleted and the user opens it
- **THEN** Tasker says the project is unavailable
- **AND** the view does not show tasks from other projects in its place
