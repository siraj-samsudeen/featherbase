## 1. Contract
- [x] 1.1 Inspect runtime, document, permissions, lifecycle and proof contracts.
- [x] 1.2 Specify declaration, caller authority, atomic replay and effect boundary.
- [x] 1.3 Strictly validate and commit design; relay consumer contract.

## 2. Implementation
- [x] 2.1 Add asymmetric failing action fixture tests.
- [x] 2.2 Implement declaration, endpoint, caller-scoped helpers and private ledger.
- [x] 2.3 Defer effects across the outer transaction and preserve lifecycle admission.

## 3. Proof
- [x] 3.1 Run focused red/green, server/shared suites and typechecks.
- [x] 3.2 Prove restart, concurrency, package delivery, permissions and rollback.
- [x] 3.3 Review spec/code/tests, run strict policy/STC and diff checks.
- [x] 3.4 Archive verified OpenSpec, commit locally and report integration boundaries.

## Verification evidence (21-Sep-2026)

- Final server suite: 829 passed, 16 skipped. Shared: 129 passed. Server and
  shared TypeScript checks passed. Focused action/delete tests: 9 passed.
- Worker-only databases: `featherbase_actions_296_test`,
  `featherbase_296_actions_commit_e2e`, `featherbase_actions_296_e2e` (port 8596).
  Verified test stamps and directly local PostgreSQL server before writes.
- Real-commit test passes both Comment/Reference versus deletion race orders
  and observes the committed ledger from an independent post-commit connection.
  Removing the Comment target lock in a disposable scratch copy made its
  concurrent-writer assertion fail; the source implementation was unchanged.
- Frozen package proof passed after renumber to 0096: eight concurrent requests,
  one destination, one Comment, one Version; thrown handler rolls back; actual
  process restart replays; missing code refuses; restoration replays again.
  Evidence: `dist/runtime-proof-lo5zCc/action-evidence.json` (local ignored output).
  Frozen core digest: `1957f75c32c536bd96e1bfeb4c77dd6eee0cacfbd5c88868116d8bdee259e262`.
- Clean 0096 migration and upgrade from prior 0093 state passed; an asymmetric
  sentinel `(37, 'prior-state-83')` survived upgrade. Other workers' 0094/0095
  migrations are not present here and need combined integration verification.
- Spec five-axis, code eight-axis and test three-axis self-review tightened
  raw deletion, helper lifetime, final Reference authorization and append-only
  Comment access. No unresolved high-impact invariant required Oracle.
- Independent final review/user exploration and combined upgrades/convergence
  proof remain coordinator-owned acceptance work, not claimed by these checks.
  Best-effort effects, single-server trusted execution and non-expiring ledger
  are explicit v1 limits. Retention counts cover Comment, Version and declared
  References, not arbitrary File/share soft pointers.
