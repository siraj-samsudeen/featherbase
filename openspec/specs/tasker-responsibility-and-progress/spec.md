# Manage Responsibility and Progress

**IDs:** `assignment_state_independent` · `responsibility_is_singular` · `completion_restores_state` · `discussion_stays_append_only` · `urgency_is_shared_binary`

## Purpose

The team can state who is responsible, how work is progressing and what needs
urgent attention without overloading any one signal.

## Requirements

### Requirement: assignment_state_independent
Status: governed (#296) · Built

> evidence: proven — server coverage assigns without starting work and component coverage supports self-assignment.

A task SHALL have zero or one responsible person. Any team member may assign,
reassign or take an unassigned task. Changing responsibility SHALL NOT change
work state, and changing work state SHALL NOT change responsibility. Assignment
controls SHALL have visible labels and work by keyboard.

#### Scenario: assign_not_started_task
- **WHEN** a Not started task is assigned to another member
- **THEN** that member becomes responsible and the task remains Not started.

### Requirement: responsibility_is_singular
Status: governed (#296) · Dedicated-test gap

> evidence: gap — responsibility is one nullable manifest field, but no dedicated server test proves reassignment leaves only the new person.

Responsibility SHALL be one nullable person reference, never a collection of
assignments.

#### Scenario: reassign_to_one_person
- **WHEN** a task is reassigned from one member to another
- **THEN** only the new member remains responsible.

### Requirement: completion_restores_state
Status: governed (#296) · Built

> evidence: proven — server transition cases cover Done undo and direct Done-to-Cancelled coherence.

Valid states SHALL be Not started, In progress, Blocked, On hold, Done and
Cancelled. Ticking completion SHALL set Done. Unticking SHALL restore the state
immediately preceding Done. Other states SHALL remain deliberate choices.
Completion and state controls SHALL have visible labels, work by keyboard and
communicate state with text rather than colour alone.

| State | Completion control | Inactive explanation |
|---|---|---|
| Not started | Unticked | Not offered |
| In progress | Unticked | Not offered |
| Blocked | Unticked | Optional |
| On hold | Unticked | Optional |
| Done | Ticked | Not offered |
| Cancelled | Unticked | Optional |

#### Scenario: undo_done_to_in_progress
- **WHEN** an In progress task is ticked Done and then unticked
- **THEN** it returns to In progress rather than Not started.

### Requirement: discussion_stays_append_only
Status: governed (#296) · Built

> evidence: proven — component coverage changes inactive state with and without an optional dated explanation.

The description SHALL hold the current understanding while comments append
dated discussion. Selecting Blocked, On hold or Cancelled SHALL offer, but not
require, an explanation. Saving one SHALL NOT replace the description.

#### Scenario: optional_inactive_explanation
- **WHEN** a member puts a task On hold and saves `Waiting for warehouse count`
- **THEN** the state changes and the explanation appears as a dated comment.

### Requirement: urgency_is_shared_binary
Status: governed (#296) · Built

> evidence: proven — a two-user server case and browser flow show shared urgency without changing private focus.

Urgency SHALL be one shared binary signal: Urgent or Not urgent. It SHALL be
labelled, keyboard-operable, reversible and independent of responsibility and
private focus. Urgency SHALL NOT be communicated by colour alone.

#### Scenario: urgent_without_focus
- **WHEN** one member marks a normal task Urgent
- **THEN** every member sees Urgent and nobody's My Focus changes.
