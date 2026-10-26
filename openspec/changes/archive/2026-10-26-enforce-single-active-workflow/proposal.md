# Proposal

## Why

Activating a second workflow can silently replace a Table's approval rules today. Issue #266 requires an explicit switch so administrators know which rules govern their rows, even when two people activate alternatives at once.

## What Changes

- Allow at most one active workflow for each Table, enforced atomically by the database.
- Refuse a conflicting save with a message naming the existing active workflow.
- Keep inactive alternatives and workflows for different Tables independent; switching requires explicit deactivation first.
- Remove newest-edited selection as a way to resolve duplicate active workflows.
- Fail visibly when installing the invariant on a development database with duplicates; do not reconcile or backfill data.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-and-approvals`: Add one-active-workflow and explicit-switch promises.

## Impact

Workflow lookup and save enforcement, one schema migration, focused HTTP integration tests, and a disposable-database committed concurrency proof. No dependencies, permission rules, toolbar behavior, workflow composition, or priorities change.
