# Tasks — approval controls, not application implementation

## 1. Gate 1 product specification

- [x] 1.1 Initialize an empty-history benchmark branch with pinned OpenSpec tooling; verify no candidate source is tracked.
- [x] 1.2 Obtain explicit owner approval of specs/todo/spec.md; owner approved with “Yes” in the manager conversation, as recorded in gate-2-acceptance-design.md.

## 2. Subsequent gated planning

- [x] 2.1 Propose Gate 2's design; the owner explicitly approved the shortened version in the manager conversation.
- [x] 2.2 Implement and independently validate the Gate-3 suite: initially 11 selftests/85 cases; disclosed corrections now pass 12 selftests and list 93 cases. `npm run spec:check` passes 1 change. See suite/README.md for onboarding, coverage, and limitations.
- [x] 2.3 Open contract PR #362 and launch the six Medium-mode candidates. The owner explicitly waived the Gate-3 approval wait; no merge or deployment is authorized.
- [ ] 2.4 Complete independent acceptance and present all ten weighted categories for Gate-4 owner review, preserving original failures and separating measured evidence from judgments and unassessed gaps.

Stop after the independently tested release-1 comparison for Gate-4 owner review. Later release and extraction gates still require explicit approval.
