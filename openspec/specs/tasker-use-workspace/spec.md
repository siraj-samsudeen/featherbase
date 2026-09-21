# Use the Tasker Workspace

**IDs:** `workspace_navigation_is_stable` · `task_lists_present_one_consistent_control_set` · `workspace_adapts_to_available_space` · `workspace_visual_hierarchy_is_clear`

## Purpose

A team member can move among Tasker's destinations, scan work and act on a task
without relearning the workspace at different screen sizes.

## Requirements

### Requirement: workspace_navigation_is_stable
Status: governed (#296) · Built

> evidence: proven via projects_landing_flow — the component test checks destination order, the complete project directory, task counts and project selection.

The primary destinations SHALL appear in this order: Inbox, My Work, Together,
Personal tasks, Views and Projects. Views SHALL open the current person's
private saved-view directory. The sidebar SHALL then list every readable
project by name and task count. Sidebar project rows SHALL open their project
and SHALL NOT contain star or reorder controls.

#### Scenario: move_from_destinations_to_a_project
- **GIVEN** Tasker has two readable projects
- **WHEN** a member scans the sidebar
- **THEN** the primary destinations appear in the specified order, including Views
- **AND** both projects appear below Projects with their task counts
- **WHEN** the member chooses one project
- **THEN** its task list opens.

### Requirement: task_lists_present_one_consistent_control_set
Status: governed (#296) · Built · rule-tier evidence

> evidence: rule-tier via task_list_surface — the reusable row exposes state, destination, responsibility, urgency and private focus; density and alignment were visually inspected.

Every destination SHALL use one consistent task-list surface. Each row SHALL
keep title, work state, destination, responsibility, shared urgency and private
focus together. Blocked and On hold tasks SHALL expand their latest explanation
without replacing those controls.

#### Scenario: scan_shared_and_private_signals_together
- **GIVEN** a Blocked urgent task is not in My Focus and has an explanation
- **WHEN** it appears in any Tasker destination
- **THEN** its state, destination, responsibility, urgency and focus controls are available in one row
- **AND** its Blocked explanation is visible with that row.

### Requirement: workspace_adapts_to_available_space
Status: governed (#296) · Built · rule-tier evidence

> evidence: rule-tier via responsive_workspace_flow — the mobile Projects landing and page overflow are browser-checked; the horizontally scrollable project strip and wider states were visually inspected.

Tasker SHALL remain usable on wide desktop and 375-pixel mobile viewports without
page-level horizontal overflow. On mobile, Projects creation and the project
directory SHALL stack vertically, while the sidebar project strip MAY scroll
horizontally rather than compressing project names beyond recognition.

#### Scenario: mobile_projects_landing
- **WHEN** a member opens Projects on a 375-pixel viewport
- **THEN** New project and the directory stack without page-level horizontal overflow
- **AND** the sidebar project strip remains horizontally scrollable.

### Requirement: workspace_visual_hierarchy_is_clear
Status: governed (#296) · Built · rule-tier evidence

> evidence: rule-tier via responsive_workspace_flow — desktop and mobile screenshots were inspected; automated tests do not judge visual hierarchy.

The main workspace SHALL use a light canvas separated from a high-contrast dark
sidebar. Destinations SHALL have distinct recognizable icons. Interactive
controls and surfaces SHALL use a consistent rounded treatment, and every
keyboard-operable control SHALL show a visible focus indicator.

#### Scenario: keyboard_focus_remains_visible
- **WHEN** a member moves keyboard focus through sidebar destinations and task controls
- **THEN** the focused control is visibly distinguishable without relying on pointer hover.
