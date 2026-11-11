## 1. Platform

- [x] 1.1 Approval types: the manifest's `approvalTypes`, the Approval Type Table and its controller, the instance settings file, migration 0160; access-granting types approve first always. Verify `apps/server/test/approval-modes.test.ts`, `apps/server/test/instance-settings.test.ts`.
- [x] 1.2 Apply now in propose; confirm; undo that restores or refuses. Verify `apps/server/test/approval-modes.test.ts`.
- [x] 1.3 Two reviewers at once. Verify `apps/server/test/change-proposals-commit.test.ts` (CHANGE_PROPOSAL_COMMIT_PROOF=1).

## 2. Dash

- [x] 2.1 Dash's three approval types, applied at once and shown not yet reviewed; Undo; the reviewer's Confirm and Undo; a removal not undone once put elsewhere. Verify `client-apps/jeyarama/dash/platform-test/my-sections.test.ts`, `src/sections-page.test.tsx`.
- [x] 2.2 Reach follows at once; an undone addition reaches no more. Verify `platform-test/provider.test.ts`.
- [x] 2.3 The client instance sets the three types to Apply now. Verify `client-apps/jeyarama/instances/dash/instance-settings.json`.
- [ ] 2.4 Independent verifier against #1191's checklist, with screenshots.
