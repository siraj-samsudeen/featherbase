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

Evidence: PR #847, working thread T-01a19bc7-5395-76ef-94a5-56ce8991f853. Effective acceptance: 90 scenarios/612 steps; focused form: 32 tests; shared: 238 tests; server: 159 tests; typecheck/init passed. Independent desktop 1280/touch 375 verification passed. Wider web run: 1360 tests passed, one Tasker import-resolution collection failure; isolated rerun passed 51 with 2 expected failures. Neither local cross-model reviewer CLI is installed. Dependency #774 integration and provisional 0011 migration ordering remain pre-merge gates; no merge/deploy performed.
