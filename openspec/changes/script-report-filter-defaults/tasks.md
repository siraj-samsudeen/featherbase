## 1. Acceptance first

- [ ] 1.1 Add executable steps for the three filter-default scenarios using real report metadata, requests and results; confirm the first-answer scenario fails on unchanged code.
- [ ] 1.2 Extend the existing sandboxed web tests for false/zero, Check defaults, edits, clearing and report navigation.

## 2. Fix and verify

- [ ] 2.1 Initialize defaults before the first run without reapplying them over user choices; keep existing control semantics.
- [ ] 2.2 Run targeted and broad web tests, typecheck, effective acceptance suite, spec guards and stack smoke.
- [ ] 2.3 Inspect representative desktop screenshots and an interaction recording; obtain independent headless UI verification against #778.
- [ ] 2.4 Commit/push and prepare a PR, subscribe exact-head CI and PR comments, and report remaining owner review/archive/merge gates to #770's manager.
