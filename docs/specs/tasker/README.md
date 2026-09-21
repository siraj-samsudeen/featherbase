# Tasker product specification

**Evidence mode:** excluded — this index carries context and links, not behavior obligations.

Tasker is a shared task list for one trusted team. Every signed-in member can
see and edit shared projects and tasks. Personal focus, starred projects and
display preferences belong only to the person who set them.

## Product assumptions

These are working assumptions, not permanent product rules:

| Assumption | Established | Revisit when |
|---|---|---|
| Shared work is acceptable to one trusted team; assignment is not access control. | Issue #296, 21-Sep-2026 | A team needs private or restricted work. |
| Ordinary Featherbase list limits are adequate for the initial small-team product. | Issue #296, 21-Sep-2026 | Observed use approaches a list limit or makes a view slow. |

These short feature specifications are the authoritative product contract:

| Feature | Implementation |
|---|---|
| [Share Work Across the Team](shared-team-work.md) | Built |
| [Quick Task Capture](quick-task-capture.md) | Built |
| [Process Inbox Items](process-inbox-items.md) | Placement rules built; guided processing loop is a gap |
| [Start a Project](start-a-project.md) | Built |
| [Star Projects for Quick Access](star-projects-for-quick-access.md) | Built |
| [Reorganize Projects](reorganize-projects.md) | Rename built; combine and split are future ideas |
| [Manage Responsibility and Progress](manage-responsibility-and-progress.md) | Built, with one dedicated-test gap |
| [Plan My Work](plan-my-work.md) | Built |
| [Review Team Workload](review-team-workload.md) | Built |
| [Use Task Details](use-task-details.md) | Built |

## Deliberately deferred

- Bulk Inbox processing; the guided one-at-a-time flow comes first.
- Due dates, reminders, overdue rules and recurring tasks.
- Dependencies, subtasks, time tracking, capacity planning and private tasks.
- Inbox ordering; real usage will decide it.
- Combining, splitting, archiving and deleting projects. These belong to
  Reorganize Projects or a future Retire a Project feature only after their
  behavior is decided.

Runtime package installation, storage identity, enablement and client hosting
are Featherbase architecture, not Tasker product behavior. They remain in
[`0011-runtime-packages.md`](../0011-runtime-packages.md).
