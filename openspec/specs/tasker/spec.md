# Tasker

## Purpose

Tasker is a shared task list for a trusted team. It supports neutral capture,
lightweight project work, explicit responsibility, reversible work states, and a
private daily shortlist without turning assignment, urgency, and personal focus
into one overloaded concept.

This is an **additive OpenSpec evaluation** of
`docs/specs/0010-task-management.md`, which remains authoritative. Legacy IDs are
preserved because tests, issue #296, and implementation comments already use them.

## Domain assumptions

### Assumption: one_trusted_team
- **Assumption:** the team’s work may be shared among every signed-in member;
  private tasks are not yet required.
- **Established by:** the product decision recorded in issue #296 and spec 0010.
- **When:** 2026-09-21.
- **Detected by:** product review. No runtime probe can determine whether the
  team’s trust model has changed.

### Assumption: small_team_lists
- **Assumption:** ordinary Featherbase list limits are adequate for the first
  small-team release; portfolio-scale planning is not required.
- **Established by:** the first-release scope in spec 0010.
- **When:** 2026-09-21.
- **Detected by:** observed list latency, pagination friction, or user reports.

## State tables

### Destination

| Project | Personal tasks owner | Meaning | Responsibility |
|---|---|---|---|
| empty | empty | Inbox | unchanged |
| set | empty | Team project | unchanged |
| empty | set | Personal tasks | owner is responsible |
| set | set | invalid | rejected |

### Work state and completion shortcut

| Action | Result |
|---|---|
| create task | Not started, not done |
| choose In progress / Blocked / On hold / Cancelled | chosen state, not done |
| choose Done or tick completion | Done, done; remember preceding state |
| untick completion | restore the state immediately preceding Done |

## Requirements

### Requirement: team_shares_tasker_work
Legacy ID: TSK closure — actors and permissions · `shape: contract`
Status: governed (#296)
Every signed-in team member SHALL be able to read, create, and edit every Tasker
project and task. Personal focus preferences SHALL remain caller-owned.

#### Scenario: unassigned_member_edits_task
- **WHEN** a team member who is not responsible for a task opens and updates it
- **THEN** the task remains visible and editable without assigning that member.

### Requirement: capture_neutral_task
Legacy IDs: TSK-R1, TSK-J1 · `shape: contract`
Status: governed (#296)
A non-empty title SHALL be sufficient to create a task. The task SHALL start Not
started, not urgent, unassigned, and without a destination. Capture SHALL return
focus to the entry field for another task.

#### Scenario: neutral_defaults
- **WHEN** a member enters `Review September stock variance` in Quick capture
- **THEN** it appears immediately with the neutral defaults.

#### Scenario: entry_stays_ready
- **WHEN** the captured task appears
- **THEN** the entry field remains focused and ready for another title.

### Requirement: inbox_is_destination
Legacy ID: TSK-R2 · `shape: rule`
Status: governed (#296)
A task SHALL be in Inbox exactly when both its project and Personal tasks owner
are empty. Its author SHALL NOT be treated as its responsible person.

#### Scenario: author_is_not_assignee
- **WHEN** Siraj captures a title without triaging it
- **THEN** the task is in Inbox and remains unassigned.

### Requirement: one_task_destination
Legacy ID: TSK-R3 · `shape: invariant`
Status: governed (#296)
A task SHALL belong to exactly one of Inbox, one project, or one person’s Personal
tasks. A project and Personal tasks owner together SHALL be rejected.

#### Scenario: dual_destination_rejected
- **WHEN** one write supplies both a project and a Personal tasks owner
- **THEN** the write is refused and the task is not saved in an impossible state.

### Requirement: personal_destination_assigns_owner
Legacy ID: TSK-I1 · `shape: invariant`
Status: governed (#296)
When a task belongs to one person’s Personal tasks, that person SHALL be its
responsible person.

#### Scenario: move_to_personal
- **WHEN** a member moves an Inbox task to Siraj’s Personal tasks
- **THEN** Siraj becomes responsible and the work state is unchanged.

### Requirement: lightweight_project_entry
Legacy IDs: TSK-R4, TSK-J2 · `shape: contract`
Status: governed (#296)
A project SHALL require only a name. Submitting task titles inside it SHALL add
unassigned Not started tasks without navigating to a full form.

#### Scenario: rapid_project_tasks
- **WHEN** a member creates `Warehouse review` and submits three titles
- **THEN** three unassigned tasks appear in that project and entry stays in place.

### Requirement: assignment_state_independent
Legacy ID: TSK-R5 · `shape: rule`
Status: governed (#296)
A task SHALL have zero or one responsible person. Assignment and reassignment
SHALL NOT change work state; changing work state SHALL NOT change responsibility.

#### Scenario: assign_not_started
- **WHEN** a Not started task is assigned to another member
- **THEN** that member is solely responsible and the task remains Not started.

### Requirement: completion_restores_state
Legacy ID: TSK-R6 · `shape: state machine`
Status: governed (#296)
Valid states SHALL be Not started, In progress, Blocked, On hold, Done, and
Cancelled. Ticking completion SHALL set Done. Unticking SHALL restore the state
immediately preceding Done. The other states SHALL remain deliberate choices.

#### Scenario: undo_done_to_in_progress
- **WHEN** an In progress task is ticked Done and then unticked
- **THEN** it returns to In progress rather than Not started.

### Requirement: discussion_stays_append_only
Legacy ID: TSK-R7 · `shape: rule`
Status: governed (#296)
The description SHALL hold the current understanding while comments append dated
discussion. Selecting Blocked, On hold, or Cancelled SHALL offer, but not require,
an explanation; a saved explanation SHALL display with the current inactive state.

#### Scenario: optional_blocked_explanation
- **WHEN** a task is blocked and the member saves `Waiting for warehouse count`
- **THEN** the state changes and that explanation appears without replacing the
  description.

### Requirement: urgency_is_shared_binary
Legacy ID: TSK-R8 · `shape: rule`
Status: governed (#296)
Urgency SHALL be one shared binary task flag: Urgent or Not urgent. It SHALL be
visually labelled, reversible, and independent of private focus and assignment.

#### Scenario: urgent_without_focus
- **WHEN** one member marks a normal task Urgent
- **THEN** every member sees Urgent and nobody’s My Focus changes.

### Requirement: focus_is_private_ordered
Legacy IDs: TSK-R9, TSK-J3 · `shape: rule`
Status: governed (#296)
Each person SHALL own an independent, server-synced ordered My Focus list.
Starring, unstarring, and reordering SHALL NOT change shared task fields.

#### Scenario: mixed_daily_shortlist
- **WHEN** a member stars one assigned and one unassigned task, reorders them,
  and another member has a different focus list
- **THEN** the first member’s order survives reload without changing either task
  or the other member’s list.

### Requirement: my_work_has_no_duplicates
Legacy ID: TSK-R10 · `shape: rule`
Status: governed (#296)
My Work SHALL show My Focus first in personal order, followed by tasks assigned to
the caller that are not already focused. Each task SHALL appear at most once.

#### Scenario: focused_assigned_once
- **WHEN** an assigned task is also starred
- **THEN** it appears once in My Focus and not again under Assigned to me.

### Requirement: responsibility_is_singular
Legacy ID: TSK-I2 · `shape: invariant`
Status: governed (#296)
Responsibility SHALL be one nullable user reference, never a collection of
assignments.

#### Scenario: one_responsible_person
- **WHEN** a task is reassigned from one member to another
- **THEN** only the new member remains responsible.

### Requirement: focus_never_mutates_task
Legacy ID: TSK-I3 · `shape: invariant`
Status: governed (#296)
Every focus operation SHALL change only the caller’s application preference and
SHALL NOT write destination, assignment, state, urgency, or any other shared task
field.

#### Scenario: star_unassigned_task
- **WHEN** a member stars an unassigned project task
- **THEN** it enters only that member’s My Focus and stays unassigned in its project.

### Requirement: stale_focus_self_heals
Legacy ID: TSK-H1 · `shape: hazard`
Status: governed (#296)
An unreadable or deleted focused task SHALL be omitted rather than failing My
Work, and SHALL be removed on the next focus write while readable order remains.

#### Scenario: missing_focus_reference
- **WHEN** stored focus contains one missing id between two readable task ids
- **THEN** My Focus renders the two readable tasks in order and the next write
  drops the missing id.

## Deferred

Bulk Inbox editing; due dates and reminders; recurring tasks; dependencies;
subtasks; time tracking; capacity planning; private tasks; and portfolio-scale
planning remain outside this evaluation.
