## ADDED Requirements

### Requirement: promotion_preserves_work_history
Status: governed (#296) · specified but unbuilt

> evidence: gap — requires generic declared transactional app-action contract.

Promotion SHALL create a project named from the task title and copy its optional description. A simple task SHALL be removed without a preservation prompt. A rich task SHALL remain as the new project's first task with its assignment, urgency, comments and activity preserved, only after confirmation. Cancel SHALL change nothing.

| Task condition | Result |
|---|---|
| Default Not started, not urgent, unassigned, no comments or meaningful activity | Simple, including optional description and creation-only activity |
| Any assignee, non-default state, urgency, comment or changed-field activity beyond creation | Rich |

The rich confirmation SHALL say in substance: “This task has work history that a project cannot hold directly. Tasker will create the project and keep this task as its first task so its assignment, urgency, comments, and activity are preserved. Continue?”

#### Scenario: creation_only_is_simple
- **WHEN** an unassigned default task with a description has only its creation event
- **THEN** promotion copies title/description and removes the source without a preservation prompt.

#### Scenario: previously_assigned_is_rich
- **WHEN** an otherwise default task was assigned and later unassigned
- **THEN** its activity requires the preservation prompt and Continue retains the original task.

### Requirement: promotion_is_atomic_retryable
Status: governed (#296) · specified but unbuilt

> evidence: gap — host transaction contract and executable failure/retry tests pending.

Promotion SHALL enforce source and destination permissions, stale/concurrent edits and a durable idempotency key in one host transaction. A failed operation SHALL leave neither a partial project nor a partially moved/deleted task. Retrying the same successful request SHALL return the same outcome without another project. A newly rich task SHALL never be deleted based on an earlier simple classification.

#### Scenario: failure_or_retry_does_not_duplicate
- **WHEN** promotion fails after project creation or the successful response is lost and retried
- **THEN** failure leaves the original state intact and retry returns one project only.

#### Scenario: concurrent_history_is_preserved
- **WHEN** a comment or task edit arrives after the promotion preview
- **THEN** promotion rejects the stale request or requires rich-task confirmation; it never silently removes that history.
