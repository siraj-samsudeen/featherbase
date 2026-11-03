## 1. Acceptance tests first

- [ ] 1.1 Add public HTTP red cases for schedule creation, cadence changes, pause, non-manager refusal and unsupported target/cadence.
- [ ] 1.2 Add real local job execution cases for changed/unchanged outcomes, corrections, conflicts, system attribution and undo; fail on missing engine metrics rather than infer them.
- [ ] 1.3 Add failure-after-first-candidate rollback assertions for target, batch and conflicts, plus duplicate key, removed column and unreachable-source controls.
- [ ] 1.4 Add removal and restart registration cases; add browser acceptance steps for creating and pausing a copied-table schedule.

## 2. Shared engine integration and scheduler

- [ ] 2.1 Reconcile the exact published #772 head providing shared atomic copyAgain, locking, batch provenance and observed metrics. Do not edit engine-owned paths here.
- [ ] 2.2 Add schedule linkage migration and transactional cleanup on copy/source/target removal; preserve past execution history.
- [ ] 2.3 Add System Manager-only schedule action, supported cadence validation and platform handler registration at creation and boot.
- [ ] 2.4 Run the bound target as a scoped system actor through copyAgain; record actual metrics and notify responsible administrators of new conflicts with no cell values.
- [ ] 2.5 Add copied-table controls reusing current UI and ordinary Scheduled Job editing; record numbered issue checklist and generate mockup before UI implementation.

## 3. Completion

- [ ] 3.1 Boot the isolated database and ports with init.sh; run targeted HTTP tests, local worker proof and browser acceptance with no pending steps.
- [ ] 3.2 Independently verify checklist at 1280 pixels; inspect screenshots and interaction clip. Run ordinary security review at the exact integration head, fix material findings, rerun checks.
- [ ] 3.3 Run strict OpenSpec validation, typechecks, relevant regression suites and exact-head CI; open one stacked PR, subscribe to CI/comments and report evidence to manager.
- [ ] 3.4 After owner review of evidence, sync/archive on this branch and reconcile against final #772 before manager-owned merge.
