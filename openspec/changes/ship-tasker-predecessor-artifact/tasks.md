## 1. Package both reviewed Tasker versions

- [x] 1.1 Add an asymmetric deployment-contract test for separate immutable Tasker 0.0.1 and 2.1.0 image roots and both discovery paths; verify the old target-only Dockerfile fails it.
- [x] 1.2 Copy the retained 0.0.1 artifact verbatim and the independently built 2.1.0 artifact into their versioned final-image roots, cite `@spec runtime_upgrade_recovery_boundary.packaged_upgrade_retains_exact_predecessor` at the deciding configuration and checking test, and verify the focused test passes.
- [x] 1.3 Update the runtime-upgrade deployment runbook to describe the self-contained image and current 0.0.1 → 2.1.0 preview/upgrade/activation sequence; verify every documented path and version matches the image and package manifests.

## 2. Verify the repository change

- [x] 2.1 Build and test Tasker, run focused runtime package/upgrade tests, and verify the reviewed 0.0.1 and 2.1.0 runtime digests independently.
- [x] 2.2 Run `pnpm check:specs`, the production image build or strongest available image-content check, and `git diff --check`; verify no discovery failure and no unrelated artifact enters either package root.
- [ ] 2.3 Obtain independent final-form code review under the repository review gate, resolve any findings, and rerun affected verification.

## 3. Recover and upgrade Featherbase Dev

- [ ] 3.1 Before deployment, back up and read back Dev Tasker projects, tasks, permissions and user settings; record counts and a content hash without exposing private preview credentials or retained row contents.
- [ ] 3.2 Deploy the reviewed branch artifact to the authorized Featherbase Dev service, verify Railway reports SUCCESS by deployment ID, and confirm `/api/apps` reports exact Tasker 0.0.1 active plus 2.1.0 available before mutation.
- [ ] 3.3 Through the private Dev preview, review the exact 2.1.0 plan, commit and explicitly activate it; verify only `project_description` and code-only `explicit_action_policies` are applied and no destructive, permission, job or index effect is present.
- [ ] 3.4 Restart the service and compare post-upgrade projects, tasks, permissions and user settings with the pre-upgrade backup; verify Tasker 2.1.0 is installed, enabled, available, active and not pending, with the reviewed digest and no discovery failures.
- [ ] 3.5 Exercise Tasker landing, project/task reads and one reversible or disposable write in Chromium; inspect desktop and touch-emulated mobile captures, verify normal host shell behavior separately, and smoke Feather Dash without changing it.
- [ ] 3.6 Apply Prove Before Handoff against the relevant Tasker/runtime-package specs, inspect runtime error logs, retain the prior successful deployment as the pre-commit rollback identity, and record the post-commit forward-recovery limitation.
