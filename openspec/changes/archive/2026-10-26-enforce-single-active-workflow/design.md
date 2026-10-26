# Design

## Context

See proposal.md for motivation. Workflow metadata is created by migration 0015; its active flag is a boolean and target is `ref_table`. `getActiveWorkflow` currently orders by newest edit and limits the result to one. The Workflow controller validates definitions and ensures the target state field after saving. `saveDoc` inserts and updates inside transactions/savepoints and maps database errors after rollback. The existing generic unique-error mapper cannot name the competing workflow.

## Goals / Non-Goals

**Goals:** Enforce the invariant for inserts, activations, and retargeting active workflows at the database boundary; preserve the existing generic save transaction and workflow engine.

**Non-Goals:** No new public API, workflow composition, priorities, automatic switching, duplicate reconciliation, permission changes, UI changes, or testing dependency changes.

## Decisions

1. Add a named partial unique index on `featherbase.workflow(ref_table)` where `is_active = true` in the next numbered migration. Inactive alternatives remain unrestricted. An application-only preflight check races; the database index is the authority even for direct SQL writes.
2. Translate only that named uniqueness violation into the existing HTTP 409 `ConflictError`, naming the active workflow and asking the administrator to deactivate it first. Keep workflow-specific lookup/message logic in the workflow owner; integrate minimally with the existing post-rollback save error path. Query only after the failed transaction/savepoint has rolled back, so PostgreSQL can execute the lookup and see the concurrent winner. Do not alter unrelated uniqueness errors. A preflight check is optional for messaging, never the concurrency guarantee.
3. Remove newest-edit ordering and limiting from active workflow resolution. Reject multiple results visibly if encountered before migration or in a broken local schema, rather than selecting one. Preserve the bootstrap schema probe and normal single-workflow behavior.
4. Use sandboxed HTTP tests for ordinary saves and a separate opt-in independent-connection proof for committed races, following the existing commit-proof test pattern. Guard the latter with an explicit opt-in, dedicated database-name suffix, directly local connection, and test environment stamp. Coordinate transaction overlap and observe a database lock wait before releasing the first writer; a plain simultaneous promise launch is insufficient proof.

## Risks / Trade-offs

- Existing local duplicates prevent index creation → Let migration fail without modifying any workflow; explain that manual cleanup is required and test that both rows survive unchanged.
- A conflicting workflow could be deactivated or deleted between the failed write and error lookup → Keep the save refused, with a truthful retry message if no active workflow remains; never invent an identity. The normal concurrent activation proof must name the durable winner.
- Schema side effects can accidentally serialize a race → Prepare target state fields before the committed proof so it measures workflow uniqueness, not target-column creation.
- Retargeting an active workflow can bypass activation-only checks → Cover updating the target as well as inserting and toggling the flag.

## Migration Plan

Run on a fresh disposable local test database first. Install the index directly, without backfill or automatic deactivation. Exercise a pre-index duplicate dataset in an isolated transaction/database and assert that migration refuses it without data changes. A failed transactional migration leaves its ledger entry unapplied. Resolve real local duplicates manually before retrying; do not ship an automatic rollback that removes the invariant.
