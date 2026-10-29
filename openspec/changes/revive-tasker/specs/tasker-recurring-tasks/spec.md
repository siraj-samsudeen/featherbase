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
