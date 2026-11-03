## 1. Acceptance first

- [x] 1.1 Add executable steps for saved column adjustment, target reset and whole-Table adjustment; reproduce the missing editor behavior with focused component regressions on unchanged UI.
- [x] 1.2 Add migration preservation and shared title regression checks; confirm the missing title behavior.

## 2. Implementation

- [x] 2.1 Add guarded label/automatic-naming migration; preserve custom labels and existing IDs.
- [x] 2.2 Project dependent controls through generic FormView using canonical shared property maps; preserve text serialization and reset dependent state.
- [x] 2.3 Compose recognizable adjustment titles and link to the saved target's rows.

## 3. Verification and delivery

- [x] 3.1 Run targeted component/server/shared checks, effective acceptance and boot smoke.
- [x] 3.2 Independently verify actual UI at 1280 and 375; inspect screenshots and pointer/keyboard recording.
- [x] 3.3 Push stacked issue branch, open one dependency-marked PR and subscribe exact head CI/comments. No merge/deploy.
- [ ] 3.4 Sync/archive after review evidence is accepted and report remaining delivery gates.

## 4. Ordinary review round-one corrections

- [x] 4.1 Record manager-authorized one-adjustment-per-setting refusal as a new decision in the existing specs, issue and PR; coordinate the controller boundary with #739.
- [x] 4.2 Reproduce/fix old-target server and client cache staleness with warmed-metadata HTTP and cached-form regressions.
- [x] 4.3 Refuse duplicate creates/retargets while preserving self-edit, empty scope normalization and other tuples; prove real committing concurrent requests admit one adjustment.
- [x] 4.4 Verify corrective acceptance, types and boot; independently exercise desktop/touch refusal and warmed SPA moves; inspect final captures/recording.
- [x] 4.5 Obtain round-two review of the bounded corrective delta; keep provenance, dependency and migration inventory gates explicit.

Evidence: PR #847, working thread T-01a19bc7-5395-76ef-94a5-56ce8991f853. After correction: effective acceptance 93 scenarios/633 steps; focused forms 33 tests; targeted server 159 tests including committing concurrency; both typechecks and init passed. Shared 238 tests passed before this delta, which changes no shared source. Independent desktop 1280/touch 375 verification passed again, including warmed SPA forms without document reload. Validation-only admitted 8/8 in a fresh-process committed HTTP regression; the before-row-lock mutex admits 1/refuses 7. Do not use the earlier stale-service 12-request probe as validation-only evidence.

Pre-correction head 06e285eb passed all reported CI checks. Corrective-head CI is separate. Wider pre-correction web run: 1360 tests passed, one Tasker import-resolution collection failure; isolated rerun passed 51 with 2 expected failures. Ordinary reviewer reported no L1 and two L2s now corrected, but author/reviewer model provenance remains unverified and manager-owned. Round-one L3 unloaded-target save, provisional 0011 inventory and delete client-cache findings are documented in the PR, not fixed. Dependency #774 integration and migration ordering remain pre-merge gates; no merge/deploy performed.

## 5. Published-main integration

- [x] 5.1 Merge actual published main after #774 landed at 31ead14c; include published-main theme update 66a93582, not unmerged #800.
- [x] 5.2 Release provisional 0011 and reserve 0015_metadata_override_editor.sql, without alias. Fresh database and actual-main 0001–0006/0012 upgrade rehearsals preserve IDs, overlays and authored wording.
- [x] 5.3 Preserve canonical registry, strict text booleans, unknown-ID 404 and refusal regressions. Integrated server checks: 159 passed; focused forms: 33 passed. Final filename checks: 30 passed. Both typechecks and init smoke passed.
- [x] 5.4 Replay creation and retarget through running UI at desktop 1280 and touch-enabled Chromium 375; inspect saved/moved screenshots including scrolled phone Value. Public API confirms old/new effective metadata after move.
- [x] 5.5 Finish integrated effective acceptance: 154 scenarios/1954 steps pass; the subsequent published-main theme addition separately passes 2 scenarios/24 steps.
- [ ] 5.6 Publish coherent issue branch and follow exact-head CI. Reconcile migration inventory again before landing; archive remains separate.

Round 2 at 8fb1e542 found no L1/L2 and all reported CI passed. Manager subsequently cleared the owner-model hold. Its proposed orphan-fixture finding was withdrawn: the generic Reference-to-Table deletion sweep removes the adjustment. Inserts, updates and deletes all take the advisory lock before row locks. Remaining L3 limitations stay documented rather than expanded into this change.

The first integrated acceptance run expanded to 154 scenarios: 152 passed, two genuine creation fixtures inherited from main failed with the preserved unknown-ID 404. Only those calls in readable-labels-page.js and table-storage-page.js were changed to explicit POST; no update/rollback semantics or production validation were relaxed.
