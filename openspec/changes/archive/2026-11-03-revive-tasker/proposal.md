## Why

Tasker is needed for real team work. The owner chose to revise the existing app, then approved private personal work, structured discussion, assignable subtasks and recurrence on 29-Oct-2026. One PR will deliver the entire Tasker change.

## What Changes

- Retain Tasker as a product app and supersede #563's retirement plan through an append-only ADR amendment.
- **BREAKING**: explicit membership; personal tasks and quick capture are creator-only, including against administrators. Moving into a shared project shares the task and its contents immediately, without confirmation. Once shared, a task stays shared.
- Make My Work the default and adopt the approved Attention first layout: conversations needing action, Focus, then other assigned work.
- Add one level of assignable subtasks with their own status and discussion; explicitly finish the parent only after its subtasks are Done or Cancelled.
- Add grouped questions and replies, a chosen respondent or anyone, unread activity, asker-controlled resolution and reopening.
- Add fixed-schedule and after-completion recurrence with one active occurrence, skipped missed slots and fresh subtasks.
- Repair existing task-loading and author-name defects; adopt Shop Floor and current shell/date contracts.

## Capabilities

### New Capabilities

- `mandatory-work-privacy`: a metadata-defined access ceiling that also applies to administrators and shares.
- `tasker-subtasks`: assignable child work and parent completion rules.
- `tasker-discussions`: grouped updates, questions, replies and attention.
- `tasker-recurring-tasks`: both recurrence modes without overlapping occurrences.

### Modified Capabilities

- `tasker-shared-team-work`: membership, creator-only privacy and irreversible sharing.
- `tasker-quick-task-capture`: private capture by default.
- `tasker-process-inbox-items`: private Inbox and creator-owned personal work.
- `tasker-plan-my-work`: default destination and attention before task lists.
- `tasker-review-team-workload`: exclude private work from team lists and counts.

## Impact

Tasker metadata, permissions, client, migrations, discussion and scheduling; generic platform extension points where necessary, with no Tasker-specific platform branches. Preserve existing work and private preferences. Coordinate grants with #617 and retain tests for existing promises. The selected mockup is a layout reference, not production code or proof of implementation.

## Non-goals

No rewrite, separate teams, private projects, deeper task nesting, reactions, dedicated chat, or new task due-date/reminder features. No production deployment is authorized by this plan. Deliver all stages in one PR, with small commits and incremental verification.
