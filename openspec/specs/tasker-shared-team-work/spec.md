# Share Work Across the Team

**IDs:** `team_shares_tasker_work`

## Purpose

The trusted team can collaborate on shared work without assignment becoming an
access-control boundary.

## Product assumptions

These assumptions apply across Tasker and are not permanent product rules:

| Assumption | Established | Revisit when |
|---|---|---|
| Shared work is acceptable to one trusted team; assignment is not access control. | Issue #296, 21-Sep-2026 | A team needs private or restricted work. |
| Ordinary Featherbase list limits are adequate for the initial small-team product. | Issue #296, 21-Sep-2026 | Observed use approaches a list limit or makes a view slow. |

## Requirements

### Requirement: team_shares_tasker_work
Status: governed (#296) · Built · evidence gap

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
