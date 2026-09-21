## 1. Contract
- [x] 1.1 Inspect core File/Share schemas and supported write/authorization paths.
- [x] 1.2 Commit strictly validated OpenSpec design before code.

## 2. Implementation and proof
- [x] 2.1 Prove missing retention with failing asymmetric tests.
- [x] 2.2 Add counts and transaction/lifecycle target locking.
- [x] 2.3 Prove both race orders, raw/action deletion and restart/rollback.
- [x] 2.4 Run isolated full server/shared/types/spec/STC/policy/package checks.
- [x] 2.5 Review, archive, commit and report integration contracts.

## Evidence (21-Sep-2026)

- Red: Admin's two File attachments and one Share were ignored; action returned
  deleted=true. Green: files=2/shares=1 and deleted=false, raw DELETE refusal,
  failed action key absent, unrelated/table-level/unattached links ignored,
  missing-target moves and disabled-target creates refused without changing links.
- Focused action/deletion tests: 10 passed. Server: 830 passed, 16 skipped.
  Shared: 129 passed. Shared/server typechecks and strict OpenSpec/STC/policy passed.
- Opt-in real-commit proof: four independent Comment/Reference/File/Share writers
  wait behind deletion, then fail after it commits; inverse ordering retains
  all links and refuses deletion with comments=1/references=1/files=1/shares=1.
- Frozen-package proof passed with failure rollback and File/Share refusal replay
  after real process restart. Local evidence: `dist/runtime-proof-BtZ8Q7/action-evidence.json`.
  Core digest: `203497d61ca4d631bdaf9219978edf2a6952bd7c0f710a95345cd76aba743bef`.
- Worker-only DBs: featherbase_actions_296_test,
  featherbase_296_actions_commit_e2e, featherbase_actions_296_e2e (port8596).
  Directly local PostgreSQL and test stamps checked. No migration or shared writes.
- Self-review: spec five-axis names the exact governed link families; code
  eight-axis keeps one retention counter and one generic save target guard;
  test three-axis uses unequal counts and both real race orderings. No unresolved
  high-impact invariant required Oracle. Independent combined review is coordinator-owned.
- Integration must retain convergence's private-schema qualification. Older
  committed results replay unchanged and can lack files/shares; new helper
  results always include them. External upload bytes remain outside PostgreSQL:
  failure after storage upload may leave an unlinked object, but cannot commit
  a File document targeting a deleted runtime row. No broader storage atomicity
  or arbitrary soft-pointer guarantee is claimed.
