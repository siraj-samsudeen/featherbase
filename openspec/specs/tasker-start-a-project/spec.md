# Start a Project

## Purpose

A team member can turn a body of work into a named project and begin listing its
tasks without completing project administration first.

## Requirements

### Requirement: lightweight_project_entry

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

### Requirement: projects_landing_connects_directory_and_creation

Choosing the main Projects destination SHALL clear the selected project and open
a central landing page. The landing page SHALL list every readable project with
its task count and SHALL contain New project creation. Project creation SHALL NOT
appear in the sidebar. Choosing a project SHALL open its task list. Opening one
of those tasks SHALL retain the selected project behind the task details.

#### Scenario: inspect_all_projects_before_choosing
- **GIVEN** two projects contain different numbers of tasks
- **WHEN** a member chooses the main Projects destination
- **THEN** the central landing page lists both projects with their task counts
- **AND** New project creation is available there rather than in the sidebar.

#### Scenario: task_details_keep_project_context
- **WHEN** a member chooses a project from the landing page and opens one of its tasks
- **THEN** task details open without replacing the selected project context.
