# Reorganize Projects

**IDs:** `project_name_is_correctable`

## Purpose

The team can correct how existing work is named or grouped without recreating
the work.

### Requirement: project_name_is_correctable
Status: governed (#296)

> evidence: proven via project_coordination_flow — a populated project is renamed through optimistic concurrency and retains its tasks.

A team member SHALL be able to rename a project while retaining its stable
identity and connected tasks. The new name SHALL appear wherever that identity
is shown. A stale rename SHALL be rejected rather than overwrite a newer edit.

#### Scenario: rename_keeps_tasks

- **WHEN** `September stock review` is renamed `Stock review — September`
- **THEN** existing tasks, quick-access projects and destination choices show the new name
- **AND** no task or project is recreated.

Combining and splitting projects are natural future extensions of this feature,
but their task movement, collision, history and reversal rules are not settled
and are not part of the current contract.
