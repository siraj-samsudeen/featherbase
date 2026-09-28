# Tasks — approval controls, not application implementation

## 1. Gate 1 product specification

- [x] 1.1 Initialize an empty-history benchmark branch with pinned OpenSpec tooling; verify no candidate source is tracked.
- [x] 1.2 Obtain explicit owner approval of specs/todo/spec.md; owner approved with “Yes” in the manager conversation, as recorded in gate-2-acceptance-design.md.

## 2. Subsequent gated planning

- [x] 2.1 Propose Gate 2's design; the owner explicitly approved the shortened version in the manager conversation.
- [x] 2.2 Implement and independently validate the Gate-3 suite: `npm run suite:selftest` (11 passed), `npm run suite:list` (85 cases), and `npm run spec:check` (1 passed). See suite/README.md for limitations.
- [ ] 2.3 Open the contract PR, then launch six Medium-mode candidates from its frozen commit. The owner explicitly waived the Gate-3 approval wait; no merge or deployment is authorized.

Stop after the independently tested release-1 comparison for Gate-4 owner review. Later release and extraction gates still require explicit approval.
