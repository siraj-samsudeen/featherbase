# Reorganize Projects

**IDs:** `project_name_is_correctable`

## Purpose

The team can correct how existing work is named or grouped without recreating
the work.

## Requirements

### Requirement: project_name_is_correctable
Status: governed (#296) · Built · evidence gap

> evidence: rule-tier via project_coordination_flow — rename and task retention are tested; rejecting a competing stale rename lacks a dedicated asymmetric test.

A team member SHALL be able to rename a project while retaining its stable
identity and connected tasks. The new name SHALL appear wherever that identity
is shown. A stale rename SHALL be rejected rather than overwrite a newer edit.

#### Scenario: rename_keeps_tasks
- **WHEN** `September stock review` is renamed `Stock review — September`
- **THEN** existing tasks, quick-access projects and destination choices show the new name
- **AND** no task or project is recreated.

Combining and splitting projects are future ideas, not current requirements.
