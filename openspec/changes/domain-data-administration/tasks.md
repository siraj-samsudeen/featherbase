## 1. Handoff and acceptance examples

The owner requests backend/data verification, not more simulation UI. The browser
prototype has been discarded at the owner’s request; prior UI work is
historical only. It does not count as production permission coverage.

- [x] 1.1 Record the agreed rules, logical data model and synthetic bootstrap-to-approval examples in the OpenSpec artifacts. Preserve prototype defaults separately from agreed requirements.
- [x] 1.2 Discard the disposable prototype and capture the current done/pending state in design.md. Do not include the HTML in this PR or require owner UI review to proceed with the handoff.
- [x] 1.3 Supply sample-data.json with initial records, scenario-specific rows and expected outcomes. Record the owner-approved policies and sample field set separately from remaining implementation defaults; check IDs, foreign keys, permission-column ownership and case references. This is design data, not a runtime fixture or import contract.
- [x] 1.4 Reconcile this proposal against current main and #246, #392, #449, #617 and #627. The source audit was at 40151182. Record overlaps, superseded assumptions and existing reusable implementation before writing code.

## 2. Production design gate

The four follow-up policies and initial sample field set are agreed. Resolve the
remaining physical mapping, contract and migration questions with concrete records
and expected outcomes, not another UI prototype.

- [x] 2.1 Map the agreed separation of operational contacts from sign-in/recovery data to the current Employee/Person/account schema, using the agreed sample: read Name, Employee number, Operational phone and Emergency contact; update only the latter two (V28 verifies account separation). Shared contact maintenance uses any matching authorised membership (V22, agreed); bulk submissions process permitted rows with explicit per-row applied/pending/rejected results (V23, agreed). Approval authority is independent of direct-edit rights (V24, agreed); define its scoped column representation in the implementation contract.
- [x] 2.2 Define the membership and job-capability contracts with #617: correlated scope tuples, missing/ambiguous results, temporal activation, cycles and locking. Cover JA3/JA6, acting JA8 and multi-membership without a cross-product.
- [x] 2.3 Specify protected grant/revoke operations, shared-role/binding-change checks, successor-office resolution and delegation descendant limits. Grant and revoke authority are independently scoped (owner-approved); no direct grant, revocation, role edit or appointment change may exceed the corresponding boundary.
- [x] 2.4 Reconcile approval application, proposal versioning and rule combination with #627. Specify fresh review and maker/approver/scope revalidation through the normal save path.
- [ ] 2.5 Finalise migration mapping for flags/tiers, creator-only access, shares, Data Scope, app entry policy and Platform Admin naming. Preserve submit/cancel/amend behaviour and system-written protections. Obtain decisions on unresolved policies, then split implementation into bounded changes.

## 3. Server implementation and sample-data verification

Use tdd and the repository's existing real Postgres rollback sandbox. Construct
sample values inline per test; do not load the design JSON as a test fixture.
Declare app models through Table metadata. No new frontend or simulation UI work.

Implemented locally: explicit operation/Column grants, complete correlated scopes,
bounded delegation and held proposal application. App-owned data does not inherit
platform-admin bypasses. Regression scenarios live in `domain-administration`,
`domain-delegation` and `domain-approvals` server tests and Dash's
`platform-test/administration.test.ts`. A separate `domain-administration-commit`
suite proves cross-connection revocation and concurrent review behavior. The
scenario coverage audit is recorded in design.md. Installed legacy artifact
migration remains open; successful fresh-install tests do not complete it.

- [ ] 3.1 Add approved metadata and converging migrations for per-operation/column permissions, scope and provenance, claiming migration numbers under #566. Verify fresh/local restored-database migrations and legacy access mapping.
- [x] 3.2 Implement complete-grant evaluation and current membership. Through public server operations, verify independent create/read/update column sets, delete, self/direct/subtree/named scopes, fail-closed missing scope and correlated tuples; assert forbidden fields never save partially.
- [x] 3.3 Implement bounded delegation and checked job-derived authority. Use Meera/Arun/Ravi and RA6/JA6/JA7/JA8 to verify grant boundaries, transfer, revoked authority, successor continuity and direct/indirect escalation refusal. Include shared-role edits and future appointments. Verify V29–V30: removing powers needs independently scoped revoke authority; grant-only and revoke-only authority cannot substitute for each other, and mixed replacements check both atomically.
- [x] 3.4 Implement held proposals through existing approval/save machinery. Exercise Arun proposal CP1 and Meera approval, rejection reason, no self-approval, mandatory rule composition, original/current/proposed conflicts, replay protection and current maker/approver authority.
- [x] 3.5 Run the sample verification cases as independent server integration scenarios, asserting returned data and persisted rows, proposals, decisions and history. Cover list/report reads, imports/bulk/API paths and concurrency beyond the illustrative dataset. Convert unresolved cases only after their policies are decided.
- [x] 3.6 Replace app decides_scope protection only after equivalent domain/scope/approval checks pass across public and trusted write paths. Keep platform access configuration and system-written audit protection separate. Verify direct data maintenance cannot self-widen authority.

## 4. Integration and delivery

- [ ] 4.1 Run applicable commands from docs/TESTING.md, server typecheck, smoke and check:specs. Exercise the complete grant → edit → approve and refusal cases through actual server APIs with the synthetic data. Record exact reproducible commands and results in the implementation PR; browser simulation checks do not satisfy this task.
- [ ] 4.2 Use feather-code-review for hidden permission, transaction and migration logic. Respect the repository's review-round limits; fix real blockers and record remaining findings with explicit dispositions.
- [ ] 4.3 Rehearse any trial-data migration on a restored snapshot with target settings and follow docs/DEPLOY.md for release approval. Do not deploy as part of this handoff.
- [ ] 4.4 Only after implementation and server verification are complete, sync/archive this change in the finishing PR and update #462. Keep this change active while backend work remains; do not close #462 based on design examples alone.
