# Tasker Recurring Tasks

## Purpose

Repeat useful work on a schedule or after completion, with fresh steps each time and a separate record of what happened before.

## ADDED Requirements

### Requirement: Repeat by schedule or completion

The user SHALL choose a fixed daily, weekly or monthly schedule, or an interval measured from completion. The chosen mode SHALL make clear when the next occurrence is expected.

#### Scenario: Wait after completion

- **WHEN** the user completes a task on Wednesday that repeats seven days after completion
- **THEN** its next occurrence is due to be created the following Wednesday

### Requirement: Only one occurrence is active

A recurring task SHALL have at most one unfinished occurrence. A fixed schedule SHALL skip missed slots while that occurrence remains unfinished and resume at the next future scheduled slot after completion, without a backlog of copies.

#### Scenario: Miss a weekly slot

- **WHEN** last week's Monday task is still unfinished this Monday and the user completes it on Wednesday
- **THEN** no duplicate was created this Monday
- **AND** the next occurrence is created the following Monday

### Requirement: Each occurrence starts fresh

A new occurrence SHALL retain its recurring instructions, assignments and intended privacy, with fresh unchecked subtasks. Previous occurrences SHALL keep their own discussion and history, without copying that conversation into the new occurrence.

#### Scenario: Repeat a completed checklist

- **WHEN** a completed task with three finished subtasks and a resolved question repeats
- **THEN** the new occurrence has three unfinished subtasks and no copied discussion
- **AND** the previous occurrence still shows its completion and question

### Requirement: Calendar dates use the instance timezone

Fixed schedules SHALL use the instance timezone. A monthly date absent from a month SHALL use that month's last day while retaining the original anchor for later months.

#### Scenario: Repeat from January's last day

- **WHEN** a task anchored on 31 January repeats monthly
- **THEN** February's occurrence is scheduled on its last day
- **AND** March's occurrence returns to 31 March

### Requirement: Cancellation pauses future work

Cancelling an occurrence SHALL pause its series until a member explicitly resumes it. An earlier completed or cancelled occurrence SHALL NOT be reopened after the series has moved to another occurrence.

#### Scenario: Cancel the current occurrence

- **WHEN** the member cancels the active occurrence
- **THEN** the series pauses without creating another occurrence
- **AND** the member can resume repeats explicitly

#### Scenario: Undo an earlier completion

- **WHEN** the member tries to undo completion of an earlier occurrence after a newer occurrence exists
- **THEN** the earlier occurrence remains completed
- **AND** the member is directed to the current occurrence

### Requirement: Sharing carries into future occurrences

Sharing an occurrence SHALL make future occurrences shared. The recurring definition SHALL become team-visible at the next scheduled check even while the active occurrence remains open.

#### Scenario: Share an unfinished recurring task

- **WHEN** the creator moves their private recurring task into a shared project
- **THEN** the task and its dependent work become shared immediately
- **AND** the recurring definition becomes shared at the next scheduled check
- **AND** subsequent occurrences remain shared
