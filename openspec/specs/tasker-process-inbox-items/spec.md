# Process Inbox Items

**IDs:** `inbox_is_destination` · `one_task_destination` · `personal_destination_assigns_owner` · `process_inbox_one_at_a_time`

## Purpose

A team member can review work whose destination was postponed and decide where
each item belongs without changing unrelated task information.

## Requirements

### Requirement: inbox_is_destination
Status: governed (#296) · Built

> evidence: proven via quick_capture_flow — captured work appears in Inbox without assigning its creator.

Inbox SHALL contain exactly the tasks with neither a project nor a Personal
tasks owner. Opening Inbox SHALL show each task's current shared signals without
changing it.

#### Scenario: captured_task_waits_in_inbox
- **GIVEN** a task has no project and no Personal tasks owner
- **WHEN** a team member opens Inbox
- **THEN** the task appears there and remains unchanged.

### Requirement: one_task_destination
Status: governed (#296) · Built

> evidence: proven — server coverage rejects a project and Personal tasks owner together.

A task SHALL belong to exactly one of Inbox, one project, or one person's
Personal tasks. A write supplying both a project and a Personal tasks owner
SHALL be rejected.

| Destination | Project | Personal tasks owner | Responsible person |
|---|---|---|---|
| Inbox | None | None | Unchanged |
| Project | One project | None | Unchanged |
| Personal tasks | None | One person | That person |

#### Scenario: move_to_project_without_assignment
- **GIVEN** an unassigned Not started task is in Inbox
- **WHEN** it is moved to `Warehouse review` without choosing a person
- **THEN** it leaves Inbox and remains unassigned and Not started.

#### Scenario: dual_destination_rejected
- **WHEN** one write supplies both a project and a Personal tasks owner
- **THEN** the write is refused and the impossible state is not saved.

### Requirement: personal_destination_assigns_owner
Status: governed (#296) · Built · evidence gap

> evidence: rule-tier — placement assigns the owner; preserving an In progress state lacks a dedicated asymmetric test.

Moving a task to one person's Personal tasks SHALL make that person responsible.
Its work state and other shared information SHALL remain unchanged.

#### Scenario: move_to_personal_tasks
- **GIVEN** an In progress task is in Inbox
- **WHEN** it is moved to Siraj's Personal tasks
- **THEN** Siraj becomes responsible and it remains In progress.

### Requirement: process_inbox_one_at_a_time
Status: governed (#296) · Specified, not built

> evidence: gap — project and Personal placement work, but Tasker has no guided Save and next or Skip loop.

Inbox processing SHALL present one item at a time with the remaining count. Save
and next SHALL apply the chosen destination and open the next item. Skip SHALL
leave the current task unchanged and open the next item.

#### Scenario: save_and_continue
- **WHEN** a member places the current Inbox item in a project and chooses Save and next
- **THEN** that task leaves Inbox and the next item opens.

#### Scenario: skip_unresolved_item
- **WHEN** a member cannot yet decide and chooses Skip
- **THEN** the task remains unchanged in Inbox and the next item opens.
