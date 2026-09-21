# Review Team Workload

**IDs:** `together_groups_active_responsibility`

## Purpose

The team can review active work by responsible person and see work that nobody
has taken.

## Requirements

### Requirement: together_groups_active_responsibility
Status: governed (#296) · Built

> evidence: proven via project_coordination_flow — asymmetric assigned, unassigned and finished tasks appear in the expected groups.

Together SHALL group active tasks by their sole responsible person and show
tasks with no responsible person in Unassigned. Done and Cancelled tasks SHALL
not appear. A responsible person SHALL remain visible even when outside the
first fetched directory page.

#### Scenario: assigned_unassigned_and_finished
- **GIVEN** one assigned active task, one unassigned active task and one Done task
- **WHEN** a member opens Together
- **THEN** the active tasks appear in their respective groups
- **AND** the Done task is absent.
