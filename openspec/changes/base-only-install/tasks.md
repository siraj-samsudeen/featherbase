## 1. Acceptance steps — fail for the right reason, implement, pass

- [x] 1.1 Add first-run acceptance steps in the existing acceptance project for a fresh empty instance started without an instance name. Prove no apps installed and no client/test builds; then make the default dev command and init path platform-only. Preserve the named-instance scenario.
- [x] 1.2 Add CLI acceptance steps for repeatable setup, start and health; implement the proposed repository CLI surface by reusing existing startup, checks and server commands. Test actual subprocess output and exit status, including a genuine failure.
- [x] 1.3 Add the welcome-checklist steps: new local instance, optional steps deferred, resume, and genuine job failure during onboarding. Implement server-owned setup/readiness classification and the resumable setup entry using existing configuration, retaining all security checks and health history.
- [x] 1.4 Add available-app inspection steps for Tasker and Feather Dash, neither installed. Implement generic repository manifest discovery without importing app server modules or building every app; exclude test fixtures. Extend privileged metadata to show declarations without secret values or arbitrary filesystem access.
- [x] 1.5 Add explicit prepare/install steps and resulting installed-state assertions. Reuse existing build and install lifecycle, restrict preparation to known trusted repository packages, report progress and errors, and keep unavailable or incompatible artifacts un-installable. Preserve existing data on restart.
- [x] 1.6 Add instance-configuration steps for editable and file-managed settings and host secrets. Use a declared fixture for settings Tasker itself does not declare. Link existing generic forms and honor locks; show declared secret presence only. Prove non-managers are refused by the server.
- [x] 1.7 Add platform-name steps with no apps and from an installed app. Change the canonical shared destination label to Featherbase, updating name assertions without changing route paths. Coordinate the existing host-shell spec replacement with the navigation task thread.

## 2. Documentation and verification

- [x] 2.1 Rewrite Windows and macOS/Linux quick starts for the base CLI. Move named client-instance and made-up-data instructions to explicit opt-in examples. Update .env.example defaults and quick-start CI; keep application-package preparation explicit for test suites rather than booting it by default.
- [x] 2.2 Run targeted startup/CLI, real-server app management and permissions tests, web component tests, typechecks, and boot/smoke checks using a separate database and ports. Probe zero installed apps through HTTP and confirm a real operational fault remains visible.
- [x] 2.3 Run effective acceptance scenarios with zero undefined/pending steps and an HTML report, recording the first-run and explicit app-install journey. Have an independent headless UI verifier at 1280 pixels check the issue checklist against the real app; fix any differences before handoff.
- [ ] 2.4 Run pnpm exec openspec validate base-only-install --type change --strict. Present artifacts and review evidence; do not archive until the owner has reviewed the videos. No push, PR, merge or deployment without applicable authorization.

Verification checkpoint after integrating #759 and pulling the merged dependency
upgrade: all 39 combined acceptance scenarios and 280 steps passed, with no
undefined, pending or skipped steps. HTML report:
`acceptance-tests/reports/combined-install-navigation.html`.
The independent 1280-pixel UI check passed welcome, defer/resume, app inspection
and local readiness. Final rendered checks also covered installed Tasker and
switching back to Featherbase, including dark shared chrome. First-run and
explicit-install recordings were inspected.
Server checks passed 264 tests (four existing skips), web checks 113,
`pnpm check:dev` 27, and CLI subprocess integration two. Actual supervised
`./init.sh` passed server smoke and all four browser smoke checks. Server/web
typechecks and production web build passed. Three adversarial review rounds
finished with no open findings.

2.4 remains open: OpenSpec 1.16 strict validation rejects warnings that executable
fenced Gherkin lacks trigger/outcome steps. Non-strict validation has no errors;
the same steps execute successfully in Cucumber. The compatibility issue is
recorded separately; no scenarios or validator settings were weakened.
Implementation remains local and unpushed; no change was archived or deployed.
