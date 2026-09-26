## ADDED Requirements

### Requirement: Correct a task's title and description

In the side panel and full page, the user SHALL be able to correct a task's
title and description, then save or cancel. Until then, the description is
shown for reading, or as not written yet; a title cannot be left blank, and a
saved correction shows in every list straight away.

#### Scenario: Fix a title and clear a description

- **WHEN** the user changes a task's title to "Call the new supplier", empties its description and saves
- **THEN** both changes are kept
- **AND** the task list shows "Call the new supplier" without reloading

#### Scenario: Cancel an edit

- **WHEN** the user edits a task's title and then cancels
- **THEN** the task keeps its old title and nothing is saved

#### Scenario: Nothing opens for editing until asked

- **WHEN** the user opens a task with no description as a full page
- **THEN** it shows that there is no description yet, along with the task's controls, and no editing box
- **AND** choosing to edit opens the title and description with save and cancel

### Requirement: A correction in progress is never lost or overwritten

If someone else changed the task after the user started editing it, saving
SHALL be refused and the user's draft kept; moving to another task drops any
draft instead of carrying it along.

#### Scenario: Someone else saved first

- **WHEN** the user starts editing a task, Shahul changes the same task, and the user then saves
- **THEN** the user is told the task has changed and Shahul's change stays
- **AND** the user's draft is still there

### Requirement: Work on a task from its details

Task details SHALL let the user change a task's state, responsible person,
place, urgency and done tick, and take the task themselves if nobody has.
Taking a task makes the user responsible for it without changing its state or
place, so it shows in their My Work, not on their personal list.

#### Scenario: Take a task from its details

- **WHEN** the user takes a Blocked, urgent Inbox task that nobody is responsible for
- **THEN** the user is responsible for it and it shows in their My Work
- **AND** it is still Blocked, urgent and in the Inbox, and it is not on the user's personal list

### Requirement: Delete a task created by accident

The user SHALL be able to permanently delete a task created by accident, after
confirming; Tasker explains this cannot be undone and that Cancelled is the way
to keep work that is no longer needed. Only a task nobody has worked on or
linked to since it was captured can be deleted; any other, for example one with
someone responsible or a comment, is refused, as is one that changed since the
user opened it.

#### Scenario: Delete a mistaken capture

- **WHEN** the user deletes a task they just captured by mistake and confirms
- **THEN** it disappears from the Inbox and its details close

#### Scenario: Work worth keeping is not deleted

- **WHEN** the user tries to delete a task that has a comment
- **THEN** Tasker refuses and points to Cancelled instead
- **AND** the task and its comment remain
