# Use Task Details

## Purpose

A team member can open a task at the depth the work needs and understand its
current context, discussion and changes without leaving Tasker.

## Requirements

### Requirement: task_detail_has_three_modes
Status: governed (#296) · Built

Task details SHALL support compact, right-inspector and focused-page modes. The
right inspector SHALL be the initial default. Switching modes SHALL retain the
selected task. The chosen mode SHALL be a private server-synced preference that
survives reload.

#### Scenario: choose_depth_without_losing_task
- **WHEN** a member opens a task and switches from inspector to focused page and compact mode
- **THEN** the same task remains selected and every mode remains reversible.

### Requirement: task_activity_stays_in_tasker
Status: governed (#296) · Built

Task details SHALL show the current description, append-only comment entry,
existing comments and shared field-change history in chronological order. Each
activity item SHALL show its actor and time. Ordinary discussion and history
SHALL NOT require navigation to the generic Featherbase form.

#### Scenario: comment_and_edit_are_visible
- **WHEN** a member adds a comment and changes a shared task field
- **THEN** Tasker shows both events with their actor and time.

Attachments may continue to use the generic Featherbase surface in this slice.
