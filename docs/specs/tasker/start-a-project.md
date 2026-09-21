# Start a Project

**IDs:** `lightweight_project_entry`

## Purpose

A team member can turn a body of work into a named project and begin listing its
tasks without completing project administration first.

### Requirement: lightweight_project_entry
Status: governed (#296)

> evidence: proven — the component and real browser create a name-only project and enter several neutral tasks without leaving it.

A non-empty name SHALL be sufficient to create a project. An empty project SHALL
remain valid. The new project SHALL open with task entry ready. Each non-empty
task title SHALL create one task in that project, starting Not started, Not
urgent and unassigned. Pressing Enter SHALL submit project names and task titles,
and task entry SHALL remain ready after each addition.

#### Scenario: empty_project_is_valid

- **WHEN** a member creates `Warehouse review` without adding tasks
- **THEN** the project exists, opens and is ready to receive tasks.

#### Scenario: add_initial_project_tasks

- **GIVEN** `Warehouse review` is open
- **WHEN** a member submits three task titles
- **THEN** exactly three neutral tasks appear in that project
- **AND** no full task form opens between entries.
