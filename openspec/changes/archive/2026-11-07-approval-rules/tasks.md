## 1. Rules engine (server, PR 1)

- [x] 1.1 Test first (`apps/server/test/approval-rules.test.ts`, the issue's Shelf fixtures and a resolver proof app): the 12 acceptance cases of #627, held creates, bulk edit and import, fresh review, the coverage-gap email.
- [x] 1.2 Migration 0155: the Approval Rule and Approval Rule Approver Tables (System Manager only, with history); generic proposal columns on Change Proposal.
- [x] 1.3 The rule check in the save path (create and update), the held change, and the decisions API: list, approve, reject.
- [x] 1.4 Approval resolvers: an app declares them, the platform calls them for a row; a rule's names are checked when it is saved.
- [x] 1.5 Approver mail through the workflow approval mail; the gap notice to System Managers.

## 2. Screens (PR 2, UI route)

- [x] 2.1 Mockups and a numbered checklist on the issue.
- [x] 2.2 The row's pending change strip, approve and reject with a reason, and the bulk, import and save messages that say "waiting for approval".
- [x] 2.3 The independent verifier against the checklist.

## 3. Check and release

- [x] 3.1 Codex review (server logic and permissions), at most two rounds.
- [x] 3.2 CI green; change verified and archived in the last PR.
