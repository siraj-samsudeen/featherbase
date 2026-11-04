## Context

#840 builds on #772's unmerged published PR805. Existing Scheduled Job controls already own cadence, queue recurrence, execution records and failure alerts. No second scheduler or copy engine is needed.

## Goals / Non-Goals

Automatic, auditable and undoable refresh of copied tables. No production scheduling, token/account changes, generic app write grants or deployments.

## Decisions

1. Store each copy's schedule as an ordinary Scheduled Job linked to copy provenance, not a separate interval field or cron. Use one registered method per copy; boot registers existing methods before schedule synchronization. Reject unsupported targets and method reassignment. Linkage cleanup must remove queued jobs in the same database transaction as removal.
2. System Managers administer schedules, matching source connection and manual copy permissions. Do not grant every table editor source-administration powers. Default new copies to unscheduled; enabling selects hourly unless another supported cadence is chosen. Offer every 15 minutes, hourly, every 4 hours and daily, not the unrelated every-minute cadence.
3. Run as `copy-refresh:<target>` inside `runAsSystemActor`, using a non-login SessionUser, not Administrator impersonation or a persisted privileged account. Version import markers and source observations distinguish incoming source data from corrections; actor naming alone does not.
4. Call shared `copyAgain` with atomic semantics. #772 owns the per-target lock, complete streaming source read, transaction boundary, accurate changed/unchanged counts and import batch provenance. Manual and scheduled copies share atomic behavior; generic importer savepoints and matched-success counts remain unchanged. A row failure causes outer copy rollback. No scheduler-owned transaction workaround.
5. An empty successful source read marks rows deleted at source, matching manual copying and never physically deleting data. Reject a scheduler-only empty-source guard because it would make manual and automatic outcomes differ. Incomplete/failed reads roll back; never infer absence from a failed page.
6. Notify the responsible System Managers through existing email and undelivered-notice mechanisms. Existing copy metadata has no separate table-owner assignment. Do not invent an ownership subsystem; administrators are the responsible owners of source administration. Send only table name, new conflict count and review link, never cell values or credentials.

## Risks / Trade-offs

- At-least-once execution can repeat an observation after a worker crash. Shared locking prevents overlapping apply, not exactly-once queue delivery; do not claim exactly-once batches.
- A system actor has scoped System Manager access. Only platform-owned handlers may construct it, and the bound target must come from stored linkage, never arbitrary job payload.
- Accurate unchanged counts and rollback are unpublished upstream work, not currently proven by fccf95b5. Reconcile the final published #772 head and verify before claiming either.

## Migration Plan

Add copy-to-schedule linkage and transactional lifecycle cleanup, without scheduling any existing copy automatically. Boot registers linked methods. Keep execution history after removal. Remove the new schedules/linkage to roll back; native copied data remains.

## Open Questions

No owner decision requested. Shared engine integration depends on the final published #772 contract and green atomicity/metrics regressions. UI uses existing copied-table and Jobs controls; verify at 1280 pixels independently before handoff.
