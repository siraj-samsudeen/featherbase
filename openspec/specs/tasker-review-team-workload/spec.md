# Review Team Workload

## Purpose

Together is the team's view of active work, grouped by who is responsible, so
anyone can see who is carrying what and what nobody has taken yet.

## Requirements

### Requirement: Review team workload

Together SHALL show every task that is not Done or Cancelled, grouped under its
responsible person, with the tasks nobody is responsible for grouped as
Unassigned. Everyone responsible for active work gets a group, however large the
team.

#### Scenario: Open work by person

- **WHEN** Shahul is responsible for one open task, another open task has nobody responsible, a third task is Done, and the user opens Together
- **THEN** the first task is under Shahul and the second under Unassigned
- **AND** the Done task is not shown
