## 1. Acceptance-first regression slices

- [x] 1.1 Add executable steps for the missing-column scenario; observe refusal assertions fail against unchanged server, then validate named columns through the existing controller and rerun. Cover edits, chosen-Table ownership, and Custom Fields through public HTTP acceptance tests.
- [x] 1.2 Add boolean acceptance steps and parameterized HTTP regressions; observe invalid values save before implementing validation, then accept the four text spellings consistently in effective metadata. Cover every currently permitted boolean property, missing values, and update rollback.
- [x] 1.3 Add unknown-property acceptance steps and context-specific error regressions; observe errors lack guidance before extending the existing allowlist error. Preserve prohibited properties and valid Table-level overrides.
- [x] 1.4 Extract the existing context-specific property definitions and value kinds into a single shared export; change server validation/coercion to consume it and give #740 the exact export path/shape. Preserve text storage, existing allowlists, and legacy property semantics.

## 2. Completion

- [x] 2.1 Run effective acceptance scenarios with zero undefined/pending steps and an HTML report; run meaningful server regressions, typecheck, and strict OpenSpec validation.
- [x] 2.2 Verify saves, edits, refusals, unchanged persisted state after refusal, and effective metadata through the separately running HTTP server on disposable fixtures.
- [ ] 2.3 Complete required ordinary code review and triage findings. Exact-head GitHub Codex review found no issues at 179dbbdc. Manager-supplied ordinary Claude review at that head reports no level-1/2 findings and 86 passing HTTP tests; level-3 observations are recorded only in the PR body. Author/reviewer model provenance is still unverified, so the prescribed different-Claude requirement is not claimed met.
- [x] 2.4 Commit/push, open one PR, subscribe to exact-head CI and PR comments, and report evidence to the manager. Leave merge/deploy/archive gated on owner review.
- [x] 2.5 Sync the three implemented validation requirements and unchanged executable examples to the main capability spec; validate main specs and the active change.
- [ ] 2.6 After final integration checks and resolution of the required-review gate, archive this change on the same branch and rerun effective acceptance without duplicate active-delta scenarios. Do not merge or deploy.
