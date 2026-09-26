# Plan My Work

## Purpose

A person can assemble and order a private daily shortlist from shared work
without accepting responsibility or changing the tasks.

## Requirements

### Requirement: focus_is_private_ordered

Each person SHALL own an independent, server-synced ordered My Focus list.
Starring, unstarring and reordering SHALL preserve that person's order across
reload. Focus and reorder controls SHALL have visible labels and work by keyboard.

#### Scenario: mixed_daily_shortlist
- **WHEN** a member stars assigned and unassigned tasks and reorders them
- **THEN** the order survives reload and another member's focus remains unchanged.

### Requirement: my_work_has_no_duplicates

My Work SHALL show My Focus first, followed by tasks assigned to the person that
are not already focused. Each task SHALL appear at most once.

#### Scenario: focused_assigned_once
- **WHEN** an assigned task is also starred
- **THEN** it appears once in My Focus and not again under Assigned to me.

### Requirement: focus_never_mutates_task

Every focus operation SHALL change only the caller's preference. It SHALL NOT
change destination, responsibility, state, urgency or any other shared task
field.

#### Scenario: star_unassigned_task
- **WHEN** a member stars an unassigned project task
- **THEN** it enters only that member's My Focus and stays unassigned.

### Requirement: stale_focus_self_heals

A deleted or unreadable focused task SHALL be omitted rather than failing My
Work. The stale reference SHALL be removed on the next focus write while the
readable order remains.

#### Scenario: missing_focus_reference
- **GIVEN** focus contains one missing id between two readable task ids
- **WHEN** My Work loads and focus is next saved
- **THEN** the readable tasks remain ordered and the missing id is dropped.
