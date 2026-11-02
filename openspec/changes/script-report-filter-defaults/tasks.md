## 1. Acceptance first

- [x] 1.1 Add executable steps for the three filter-default scenarios using real report metadata, requests and results; confirm the first-answer scenario fails on unchanged code.
- [x] 1.2 Extend the existing sandboxed web tests for false/zero, Check defaults, edits, clearing and report navigation.

## 2. Fix and verify

- [x] 2.1 Initialize defaults before the first run without reapplying them over user choices; keep existing control semantics.
- [x] 2.2 Run targeted and broad web tests, typecheck, effective acceptance suite, spec guards and stack smoke. Full web run: 1,408 pass, two expected failures, one unrelated column-preference failure; unchanged targeted rerun: 16/16 pass. No expectations changed.
- [x] 2.3 Inspect representative desktop screenshots and an interaction recording; obtain independent headless UI verification against #778.
- [ ] 2.4 Commit/push and prepare a PR, subscribe exact-head CI and PR comments, and report remaining owner review/archive/merge gates to #770's manager.
