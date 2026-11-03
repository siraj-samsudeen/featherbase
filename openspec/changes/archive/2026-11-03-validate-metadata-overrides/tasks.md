## 1. Acceptance-first regression slices

- [x] 1.1 Add executable steps for the missing-column scenario; observe refusal assertions fail against unchanged server, then validate named columns through the existing controller and rerun. Cover edits, chosen-Table ownership, and Custom Fields through public HTTP acceptance tests.
- [x] 1.2 Add boolean acceptance steps and parameterized HTTP regressions; observe invalid values save before implementing validation, then accept the four text spellings consistently in effective metadata. Cover every currently permitted boolean property, missing values, and update rollback.
- [x] 1.3 Add unknown-property acceptance steps and context-specific error regressions; observe errors lack guidance before extending the existing allowlist error. Preserve prohibited properties and valid Table-level overrides.
- [x] 1.4 Extract the existing context-specific property definitions and value kinds into a single shared export; change server validation/coercion to consume it and give #740 the exact export path/shape. Preserve text storage, existing allowlists, and legacy property semantics.

## 2. Completion

- [x] 2.1 Run effective acceptance scenarios with zero undefined/pending steps and an HTML report; run meaningful server regressions, typecheck, and strict OpenSpec validation.
- [x] 2.2 Verify saves, edits, refusals, unchanged persisted state after refusal, and effective metadata through the separately running HTTP server on disposable fixtures.
- [x] 2.3 Complete ordinary review and triage findings. GitHub Codex review found no issues at 179dbbdc. Manager-supplied ordinary Claude review at that head reports no level-1/2 findings and 86 passing HTTP tests; level-3 observations are recorded only in the PR body. Model provenance remains unverified, not retroactively certified: on 03-Nov the owner explicitly cleared that hold and authorized finalization under CI-green merge policy. The manager retains merge authority.
- [x] 2.4 Commit/push, open one PR, subscribe to exact-head CI and PR comments, and report evidence to the manager. No self-merge or manual deployment.
- [x] 2.5 Sync the three implemented validation requirements and unchanged executable examples to the main capability spec; validate main specs and the active change.
- [x] 2.6 Archive on the same branch and rerun affected integration checks after merging main 40f12d52: 100 effective acceptance scenarios / 776 steps, 120 server regressions, 8 report tests, and 240 shared tests with 100% coverage passed. All three typechecks, spec checks, and boot/server plus four browser smoke checks passed. The final published head's full applicable CI is a separate merge condition tracked in the PR; this task does not assert it has passed. No self-merge or manual deployment.
