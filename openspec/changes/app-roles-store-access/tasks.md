## 1. Prepare and establish red tests

- [x] 1.1 Load TDD/apply/proving skills and read docs/TESTING.md; positively identify disposable local databases, boot supervised services and exercise login → Table list → form before changing application code. Record commands and baseline failures, including any unavailable named skill. Completed with directly local PostgreSQL and featherbase_issue279_proof_e2e stamped test; supervised API 8279/web 5279, real browser login → User list → New form. TDD skill invocation unavailable; explicit red-green remains mandatory.
- [x] 1.2 Add asymmetric real-Postgres/Hono tests for `fresh_app_store_access`: read-role/action-role distinction, A versus A+C versus A+B, empty/missing/malformed scope, claimed role/SQL/filter tampering, direct action, no administrator bypass, same-session removal and disabled user/app. Run focused suite and record expected red failures before implementation.
- [x] 1.3 Add independent runtime-package proof contributions with asymmetric business rows and observable handler/upstream invocation counts; verify they build separately from core and new denial assertions fail on baseline.

## 2. Declare and resolve fresh authorization

- [x] 2.1 Implement shared structural types and strict version-2 action/version-1 read declaration schemas; test missing policy, bad scope/role mapping, callback mismatch, unsupported product actions and explicit table policy. Put real STC markers at validating decisions and assertions.
- [x] 2.2 Implement the reusable callback-scoped boundary using existing roles/Data Scope, fresh enabled user/app state and complete-set checks, without changing legacy Table CRUD. Turn 1.2 green; run existing permission and user-permission tests unchanged.
- [x] 2.3 Implement keyed scope-fact reader with declared owned columns, runtime read-only shape, expired-helper refusal and held row locks; verify persisted A+B/claimed A denial, correct B+A normalization, omitted-claim complete scope, nonexistent indistinguishability, child/parent substitution and concurrent scope mutation.
- [x] 2.4 Implement declared product gate and final post-lock fresh admission; prove (A,X)/(B,Y) does not authorize (A,Y), section removal blocks cache disclosure, missing gate fails across restart, and first-run/replay product-fact waits followed by generic revocation refuse.
- [x] 2.5 Implement approved self-only discovery without callbacks; prove A-only exact result/no B, same-session removal to empty, role/user/app denial, invalid declaration/override refusal, operation isolation, and old discovery cannot authorize a later revoked read.

## 3. Integrate reads and durable replay

- [x] 3.1 Add generic app-read endpoint/loading through ordinary authentication/lifecycle/pinned identity with a runtime mutation-free read context; prove install → read → reload → role removal → disable/re-enable with no core package import or duplicate registration.
- [x] 3.2 Add additive authorization metadata migration to private action ledger and separate metadata/result queries. Prove original A+B replay after source deletion succeeds with unchanged rights; revoke B then unchanged/narrowed retries disclose nothing, reordered stores replay once, changed IDs conflict, malformed metadata refuses, and concurrent duplicate waits see revocation. Use SQL-observable result-read instrumentation or equivalent real-DB proof, not just a response assertion.
- [x] 3.3 Add bounded existing Access Log decisions outside rolled-back work; prove refusal survives rollback without payload/SQL/token/result leakage and handler/upstream counters stay unchanged on all refusal paths.

## 4. Preserve lifecycle and migrate Tasker explicitly

- [x] 4.1 Preserve exact historical artifact recognition while denying undeclared v1 actions with diagnostics. Add Tasker 2.1.0 explicit table/generic operations and code-only migration; prove preview/upgrade/activate, stale client refusal, failed-upgrade preservation, historical table-result replay and exact restart selection.
- [x] 4.2 Update independent action proving packages to explicit declarations without rewriting historical artifacts; run existing transactional action, runtime-package, upgrade, document-deletion and Tasker tests. Existing assertion changes must cite the approved changed requirement, not weaken outcomes for green tests.

## 5. Review, prove and hand off

- [x] 5.1 Review actual affected spec/test/code with spec-review-5-axes, test-review-3-axes and code-review-8-axes. Resolve in-scope findings and report routed divergences/deferred issues. Ask coordinator for independent final review with exact committed diff; consult Oracle on final scope/replay invariant and review resolutions, not an author's self-certification.
- [x] 5.2 Run focused server tests, full server/shared/web tests and workspace typechecks, strict OpenSpec, `pnpm check:specs`, and diff checks. Close the seven new requirements' intentional planning-stage STC gaps using deciding implementation/checking assertions; do not add marker-only links or expand baseline to hide missing implementation.
- [x] 5.3 Run Prove Before Handoff on positively identified disposable local data: actual HTTP package installation/read/action/replay/revocation/disable/restart, plus existing Tasker browser smoke and independent exploration coordinated by parent. Report exact commands/results and limits; no claim about native MotherDuck credential revocation or completed DASH/Budgets behavior.
- [ ] 5.4 Synchronize verified delta requirements into canonical specs, rerun linkage/validation, append dated PROGRESS.md evidence, commit stable implementation and push branch. Prepare PR with issue/plan, API/manifest/data model, tests, migration interruption and limitations; no merge/deploy. Return the same substantive evidence to coordinator and this thread.

Closeout status (2026-09-22): canonical synchronization, validation and implementation evidence are committed in PROGRESS.md. Independent review approved the implementation and verification tip; PR creation/CI/coordinator handoff remain pending at this documentation-only closeout. No merge, deployment or product-consumer completion is claimed.
