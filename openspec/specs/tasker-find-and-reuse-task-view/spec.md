# Find and Reuse a Task View

**IDs:** `task_search_stays_in_scope` · `task_filters_combine_dimensions` · `task_view_state_is_visible` · `saved_task_views_are_private_fixed` · `saved_view_changes_are_explicit` · `task_view_controls_are_accessible`

## Purpose

A person can find a useful slice of work, understand why each task is present,
and privately return to the same slice without changing shared tasks.

## Requirements

### Requirement: task_search_stays_in_scope
Status: governed (#296) · Built
> evidence: proven via find_and_reuse_task_view — unit and component tests search titles and current descriptions while excluding tasks outside the supplied project boundary.

Search SHALL match task titles and current descriptions without leaving the
open task boundary. It SHALL NOT match comments or field-change history. A
project search SHALL remain inside that project; searching another fixed
surface SHALL remain inside that surface.

#### Scenario: title_and_description_search
- **GIVEN** a project has twelve tasks and one description contains `warehouse transfer`
- **WHEN** a member searches that project for `warehouse`
- **THEN** the described task matches
- **AND** a task from another project does not appear.

### Requirement: task_filters_combine_dimensions
Status: governed (#296) · Built
> evidence: proven via find_and_reuse_task_view — unit and component tests exercise OR inside state and responsibility dimensions and AND across active dimensions.

Task-bearing surfaces SHALL filter by work state, responsible person and
urgency. A surface spanning projects SHALL also filter by project. Multiple
choices inside one dimension SHALL combine with OR; active dimensions and
search SHALL combine with AND.

#### Scenario: or_within_and_between
- **WHEN** State is `Not started` or `In progress`, Responsible person is `Shahul` or `Unassigned`, and Urgency is `Urgent`
- **THEN** a task matches one selected value in every active dimension
- **AND** a non-urgent task does not match even when its state and responsibility match.

### Requirement: task_view_state_is_visible
Status: governed (#296) · Built
> evidence: proven via find_and_reuse_task_view — component and browser tests verify removable criteria, live match counts, preserved zero-match criteria and explicit clear actions.

Tasker SHALL show every active criterion as labelled removable text, together
with the matching and available task counts. Clearing one criterion SHALL leave
the others intact. Zero matches SHALL preserve the search and filters, say that
no tasks match, and offer explicit clear actions; Tasker SHALL NOT silently
relax criteria. Together SHALL retain and visibly identify its active-work
boundary, while other unfiltered surfaces retain their existing status scope.

#### Scenario: zero_matches_are_recoverable
- **GIVEN** twelve tasks exist in the fixed boundary
- **WHEN** the current criteria match none
- **THEN** Tasker shows `0 of 12 tasks` and the active criteria
- **AND** the member can clear search or all filters without losing the boundary.

### Requirement: saved_task_views_are_private_fixed
Status: governed (#296) · Built
> evidence: proven via find_and_reuse_task_view — the two-user component journey verifies private server persistence, fixed project scope and unchanged shared task records.

A named saved task view SHALL be a private, server-synced preference containing
its fixed boundary, search text and filters. A member SHALL be able to save the
current project boundary or an explicitly across-project boundary. Reopening,
renaming or deleting a saved view SHALL NOT mutate any shared task or project.
Another member SHALL NOT be able to read the name or definition.

#### Scenario: saved_definition_round_trip
- **WHEN** Shahul saves `Urgent work assigned to Shahul` across projects
- **THEN** the same search and filters reopen on Shahul's other device
- **AND** no task field changes and no teammate receives Shahul's view.

#### Scenario: project_view_keeps_project_boundary
- **WHEN** a member saves the current setup as `This project` inside September stock review
- **THEN** reopening it never includes a matching task from Store opening readiness.

### Requirement: saved_view_changes_are_explicit
Status: governed (#296) · Built
> evidence: proven via find_and_reuse_task_view — unit and component tests exercise dirty detection, reset, rename, delete and restrictive stale-reference handling.

Opening a saved view and changing criteria SHALL create visible unsaved changes;
it SHALL NOT overwrite the saved definition until the member chooses Update.
Reset SHALL restore the saved definition. Save as new, rename and delete SHALL
be explicit actions. A saved-view URL SHALL reopen that private view for its
owner; an unavailable view or stale project/person reference SHALL be reported
without broadening the result set.

#### Scenario: reset_detects_changes
- **GIVEN** a saved view contains Blocked tasks
- **WHEN** its owner temporarily adds In progress and then chooses Reset
- **THEN** the saved Blocked-only definition returns unchanged.

#### Scenario: stale_reference_never_broadens
- **GIVEN** a saved view refers to a project or person that is no longer readable
- **WHEN** its owner opens the view
- **THEN** Tasker identifies the unavailable reference
- **AND** it does not remove that criterion and expose a broader task set.

### Requirement: task_view_controls_are_accessible
Status: governed (#296) · Built
> evidence: proven via tasker_browser_flow — browser tests operate filters by keyboard, restore focus on Escape and verify the live count; responsive_workspace_flow checks mobile bottom-sheet geometry.

The desktop workspace SHALL use a compact filter popover and the mobile
workspace SHALL use a scrollable bottom sheet. Search, filter, view, chip,
save, reset, rename and delete controls SHALL have visible labels, keyboard
operation and visible focus. Escape SHALL close the filter controls, and match
count changes SHALL be announced without relying on colour.

#### Scenario: filter_without_pointer
- **WHEN** a member uses only a keyboard to open Filter, choose two states, close it and remove one criterion
- **THEN** focus remains visible and the matching count announces each change.
