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
- [ ] 4.5 Obtain round-two review of the bounded corrective delta; keep provenance, dependency and migration inventory gates explicit.

Evidence: PR #847, working thread T-01a19bc7-5395-76ef-94a5-56ce8991f853. After correction: effective acceptance 93 scenarios/633 steps; focused forms 33 tests; targeted server 159 tests including committing concurrency; both typechecks and init passed. Shared 238 tests passed before this delta, which changes no shared source. Independent desktop 1280/touch 375 verification passed again, including warmed SPA forms without document reload. Validation-only admitted 8/8 in a fresh-process committed HTTP regression; the before-row-lock mutex admits 1/refuses 7. Do not use the earlier stale-service 12-request probe as validation-only evidence.

Pre-correction head 06e285eb passed all reported CI checks. Corrective-head CI is separate. Wider pre-correction web run: 1360 tests passed, one Tasker import-resolution collection failure; isolated rerun passed 51 with 2 expected failures. Ordinary reviewer reported no L1 and two L2s now corrected, but author/reviewer model provenance remains unverified and manager-owned. Round-one L3 unloaded-target save, provisional 0011 inventory and delete client-cache findings are documented in the PR, not fixed. Dependency #774 integration and migration ordering remain pre-merge gates; no merge/deploy performed.
