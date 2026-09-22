# Quick Task Capture

## Purpose

Write a task down the moment you think of it, and decide later — from the Inbox,
the list of tasks nobody has sorted yet — where it goes and who does it.

## Requirements

### Requirement: quick_task_capture
Typing a title and pressing Enter SHALL be all it takes to record a task. A new
task starts with these defaults:

- it lands in the **Inbox** — no project, no personal list;
- **nobody is responsible** for it, not even the user who created it;
- it is **Not started** and **not urgent**.

#### Scenario: capture_from_inbox
- **WHEN** the user, on the Inbox, types `Review September stock variance` in *What do you need
  to remember?* and presses Enter
- **THEN** the task appears in the Inbox with the defaults above
- **AND** the input box is cleared and the cursor is back in it.
