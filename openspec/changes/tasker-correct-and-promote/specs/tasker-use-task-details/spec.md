## ADDED Requirements

### Requirement: Correct a task's title and description

In the side panel and full page, the user SHALL be able to correct a task's
title and description, then save or cancel. Until they choose to edit, the
description is shown for reading, or as not written yet; the summary layout
points them to where they can edit. A title cannot be left blank, but an empty
description is fine. A saved correction shows in every list straight away. If
someone else changed the task after the user started editing, the save is
refused and the user's draft is kept. Moving to another task never carries a
draft across.

#### Scenario: Fix a title and clear a description

- **WHEN** the user changes a task's title to "Call the new supplier", empties its description and saves
- **THEN** both changes are kept
- **AND** the task list shows "Call the new supplier" without reloading

#### Scenario: Cancel an edit

- **WHEN** the user edits a task's title and then cancels
- **THEN** the task keeps its old title and nothing is saved

#### Scenario: Someone else saved first

- **WHEN** the user starts editing a task, Shahul changes the same task, and the user then saves
- **THEN** the user is told the task has changed and Shahul's change stays
- **AND** the user's draft is still there

#### Scenario: Nothing opens for editing until asked

- **WHEN** the user opens a task with no description as a full page
- **THEN** it shows that there is no description yet, along with the task's controls, and no editing box
- **AND** choosing to edit opens the title and description with save and cancel

### Requirement: Work on a task from its details

Task details SHALL let the user change a task's state, responsible person,
place, urgency and done tick, and take the task themselves if nobody has.
Taking a task makes the user responsible for it without changing its state or
place, so it shows in their My Work, not on their personal list. Closing the
details returns the user to where they were, and while the details cover the
screen the keyboard stays within them.

#### Scenario: Take a task from its details

- **WHEN** the user takes a Blocked, urgent Inbox task that nobody is responsible for
- **THEN** the user is responsible for it and it shows in their My Work
- **AND** it is still Blocked, urgent and in the Inbox, and it is not on the user's personal list

### Requirement: Delete a task created by accident

The user SHALL be able to permanently delete a task created by accident, after
confirming. Tasker explains that this cannot be undone and that Cancelled is the
way to keep work that is no longer needed. Tasker refuses to delete a task that
has anything worth keeping, such as someone responsible, urgency, a state other
than Not started, comments, change history, attachments or links to it, and
refuses if the task changed after the user opened it. A deleted task disappears
from lists, from My Focus and from the open task details.

#### Scenario: Delete a mistaken capture

- **WHEN** the user deletes a task they just captured by mistake and confirms
- **THEN** it disappears from the Inbox and its details close

#### Scenario: Work worth keeping is not deleted

- **WHEN** the user tries to delete a task that has a comment
- **THEN** Tasker refuses and points to Cancelled instead
- **AND** the task and its comment remain
