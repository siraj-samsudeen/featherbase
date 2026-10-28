## 1. Reviewable design and prototype

- [ ] 1.1 Review the planning PR with the owner, preserving the distinction between agreed rules and prototype defaults. Verify the decision trail links and ID — Name sample references are readable and internally consistent.
- [x] 1.2 Build the disposable local HTML prototype from design.md sections A–G: responsibility grant, employee edit, approval and inspectable sample rows. Verify Meera can grant RA6, Arun can propose CP1 and Meera can apply it without a live API or production data.
- [x] 1.3 Add isolated scenario controls for section/department scope, direct reports, date transfer, revocation, conflict, handover and acting-manager escalation. Verify each branch in design.md section H produces its stated result and reset restores the original seed.
- [x] 1.4 Use an independent UI verifier for the prototype at 1280px and 375px; return screenshots and a spec-versus-built table before owner review. Verify keyboard use, readable controls and no overflow.
- [ ] 1.5 Walk the prototype with the owner and record accepted changes in these artifacts. Verify explicit decisions on the employee field set, bulk request behaviour, shared personal-record footprint and approver-only authority before enabling production implementation tasks.

## 2. Production design gate

These tasks refine the implementation contract after prototype review. Do not
interpret the later implementation outline as permission to skip this gate.

- [ ] 2.1 Define the versioned membership and job-capability contracts under #617, including correlated scope tuples, missing/ambiguous results, temporal activation, cycles and locking. Verify contract examples cover JA3/JA6, acting JA8 and multi-membership without a cross-product.
- [ ] 2.2 Specify protected grant operations, role-definition and binding-change checks, successor-office resolution and delegation descendant limits. Verify there is no route to confer a capability beyond the same delegation boundary, including modifying an existing role's permissions.
- [ ] 2.3 Reconcile approval application, proposal versioning, workflow notifications and multi-rule combination with #627. Verify the owner-approved conflict example and maker/approver scope checks have explicit acceptance scenarios.
- [ ] 2.4 Finalise migration mapping for existing flags/tiers, creator-only grants, shares, Data Scope, app entry policies and Platform Admin naming across affected specs. Verify no existing permission is widened by omission or a missing scope; record the migration rehearsal and rollback procedure under docs/DEPLOY.md.
- [ ] 2.5 Obtain owner approval of the production schema/contracts and split the implementation outline below into bounded executable changes where needed. Verify all gates in design.md are resolved before production code work begins.

## 3. Implementation outline after the gate

- [ ] 3.1 Using tdd, add metadata and converging migrations for per-operation/column permissions, scoped assignments and provenance after claiming migration numbers under #566. Verify fresh and restored-database migration tests and the preserved submit/cancel/amend and creator-only cases.
- [ ] 3.2 Implement complete-grant evaluation and app-declared row membership with transactional freshness. Verify create/read/update/delete, all column sets, self/direct/subtree/named scopes, correlated tuples, transfers and concurrent revocation through real Postgres tests.
- [ ] 3.3 Implement bounded delegation, office continuity and job-derived authority checks. Verify direct grants, changed/acting/future jobs, binding changes, shared-role edits and successor handover cannot exceed the original boundaries.
- [ ] 3.4 Implement held proposals and conflict-safe application through normal save/automation paths. Verify maker/approver revalidation, no self-approval, mandatory-rule composition, rejection, fresh review, replay protection and history.
- [ ] 3.5 Apply the same checks across imports, bulk changes, workflows, hooks and app actions; replace app decides_scope guards only after coverage passes. Verify platform configuration and system-written audit protections still refuse forbidden writes, including through trusted save paths.
- [ ] 3.6 Build the approved business-facing configuration and review screens using shared components. Verify them through an independent Playwright agent at 1280px and 375px with screenshots before owner acceptance.

## 4. Integration and delivery

- [ ] 4.1 Run proportionate checks from docs/TESTING.md, including pnpm --filter server typecheck, pnpm smoke and pnpm check:specs; exercise grant → edit → approve and refusal journeys against the running server and browser. Record exact commands and results in the implementation PR.
- [ ] 4.2 Use feather-code-review for hidden permission, transaction and migration logic, at most two Codex rounds during the Feather Dash rollout. Verify real blockers are fixed and the remaining findings have explicit dispositions.
- [ ] 4.3 Rehearse any trial-data rewrite on a restored snapshot with target environment settings and follow docs/DEPLOY.md for release approval. Verify before/after grants and report coverage, including job-derived powers.
- [ ] 4.4 Only when all implementation and owner-verification work is complete, sync/archive this change in the finishing PR and update #462 and related issue boundaries. Verify pnpm check:specs and a clean working tree; do not archive this planning-only PR as delivered behaviour.
