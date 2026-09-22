# Quick Task Capture

**IDs:** `title_alone_records_task`

## Purpose

Write a task down the moment you think of it, and decide later — from the Inbox,
the list of tasks nobody has sorted yet — where it goes and who does it.

## Requirements

### Requirement: title_alone_records_task
Built: yes · Checked by a server test and a browser test.

Typing a title and pressing Enter SHALL be all it takes to record a task.

#### Scenario: capture_from_inbox
- **GIVEN** the user is on the Inbox
- **WHEN** the user types `Review September stock variance` in *What do you need
  to remember?* and presses Enter
- **THEN** a new row for the task appears in the Inbox list
- **AND** its state dropdown shows *Not started*
- **AND** its urgency button reads *Not urgent*
- **AND** its person dropdown shows *Unassigned* — creating a task does not make
  the user responsible for it
- **AND** its destination dropdown shows *Inbox* — no project, no personal list
- **AND** the input box is cleared and the cursor is back in it.
