# Tasker behavior contract

OpenSpec is the sole Tasker application-behavior contract. Platform package,
installation, storage and hosting behavior remains separate in
[`trusted-runtime-packages`](specs/trusted-runtime-packages/spec.md).

## Capabilities

In the order a newcomer learns and tests them: each one uses what the ones
before it created, and the team capabilities come after the single-person ones.

1. [Quick Task Capture](specs/tasker-quick-task-capture/spec.md)
2. [Process Inbox Items](specs/tasker-process-inbox-items/spec.md)
3. [Start a Project](specs/tasker-start-a-project/spec.md)
4. [Star Projects for Quick Access](specs/tasker-star-projects/spec.md)
5. [Reorganize Projects](specs/tasker-reorganize-projects/spec.md)
6. [Manage Responsibility and Progress](specs/tasker-responsibility-and-progress/spec.md)
7. [Plan My Work](specs/tasker-plan-my-work/spec.md)
8. [Share Work Across the Team](specs/tasker-shared-team-work/spec.md)
9. [Review Team Workload](specs/tasker-review-team-workload/spec.md)
10. [Use Task Details](specs/tasker-use-task-details/spec.md)
11. [Use the Tasker Workspace](specs/tasker-use-workspace/spec.md)

## Specified but not built

| Requirement | Evidence | Missing behavior |
|---|---|---|
| `process_inbox_one_at_a_time` | `gap` | Guided remaining-count, Save and next, and Skip loop |

## Built with incomplete evidence

These are implementation/test gaps, not additional unbuilt product behavior:

| Requirement | Evidence gap |
|---|---|
| `personal_destination_assigns_owner` | No asymmetric test preserves In progress during Personal placement |
| `project_name_is_correctable` | No competing stale-rename test |
| `responsibility_is_singular` | No dedicated reassignment test |
| `stale_project_tabs_self_heal` | No dedicated full self-healing sequence test |
| `task_activity_stays_in_tasker` | Actor and time rendering are not asserted |
| `team_shares_tasker_work` | Ordinary-member project create/edit breadth is not directly tested |
| `responsive_detail_preserves_workspace_context` | Compact full-screen locking and background hiding are visually inspected only |
| `task_lists_present_one_consistent_control_set` | Density and alignment are visually inspected only |
| `workspace_adapts_to_available_space` | Project-strip scrolling and wider responsive states are visually inspected only |
| `workspace_visual_hierarchy_is_clear` | Visual hierarchy is screenshot-reviewed, not machine-judged |

Combining, splitting, archiving and deleting projects remain future ideas, not
specified requirements. Bulk Inbox processing remains deferred; the specified
one-at-a-time processing loop comes first.
