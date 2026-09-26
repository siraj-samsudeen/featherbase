# Reorganize Projects

## Purpose

The team can correct how existing work is named or grouped without recreating
the work.

## Requirements

### Requirement: project_name_is_correctable

A team member SHALL be able to rename a project while retaining its stable
identity and connected tasks. The new name SHALL appear wherever that identity
is shown. A stale rename SHALL be rejected rather than overwrite a newer edit.

#### Scenario: rename_keeps_tasks
- **WHEN** `September stock review` is renamed `Stock review — September`
- **THEN** existing tasks, quick-access projects and destination choices show the new name
- **AND** no task or project is recreated.

Combining and splitting projects are future ideas, not current requirements.
