# Share Work Across the Team

**IDs:** `team_shares_tasker_work`

## Purpose

The trusted team can collaborate on shared work without assignment becoming an
access-control boundary.

### Requirement: team_shares_tasker_work
Status: governed (#296)

> evidence: rule-tier — ordinary-member coverage proves task reading, editing and discussion; equivalent project creation and editing breadth lacks a dedicated test.

Every signed-in team member SHALL be able to read, create and edit every Tasker
project and task. A member SHALL NOT need to become responsible for a task to
edit it. Personal preferences SHALL remain visible only to their owner. A stale
shared edit SHALL be rejected rather than overwrite a newer edit.

#### Scenario: unassigned_member_edits_task

- **GIVEN** a task is unassigned
- **WHEN** another signed-in team member updates it
- **THEN** the update succeeds
- **AND** the task remains unassigned.

#### Scenario: stale_shared_edit_is_rejected

- **GIVEN** two members opened the same version of a task
- **WHEN** one saves a change and the other then saves their stale copy
- **THEN** the stale edit is rejected and the newer change remains.
