## 1. Acceptance first

- [ ] 1.1 Add executable steps for saved column adjustment, target reset and whole-Table adjustment; confirm failures on unchanged UI.
- [ ] 1.2 Add migration preservation and shared title regression checks; confirm the missing behavior.

## 2. Implementation

- [ ] 2.1 Add guarded label/automatic-naming migration; preserve custom labels and existing IDs.
- [ ] 2.2 Project dependent controls through generic FormView using canonical shared property maps; preserve text serialization and reset dependent state.
- [ ] 2.3 Compose recognizable adjustment titles and link to the saved target's rows.

## 3. Verification and delivery

- [ ] 3.1 Run targeted component/server/shared checks, effective acceptance and boot smoke.
- [ ] 3.2 Independently verify actual UI at 1280 and 375; inspect screenshots and pointer/keyboard recording.
- [ ] 3.3 Push stacked issue branch, open one dependency-marked PR and subscribe exact head CI/comments. No merge/deploy.
- [ ] 3.4 Sync/archive after review evidence is accepted and report remaining delivery gates.
