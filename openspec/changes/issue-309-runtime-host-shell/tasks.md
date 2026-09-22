## 1. Manifest and host composition

- [ ] 1.1 Add the optional strict `presentation: "fullscreen"` runtime manifest declaration and carry it through artifact selection; verify default, fullscreen, and rejected unknown-value cases in `runtime-packages.test.ts` with `@spec` links.
- [ ] 1.2 Compose the host-owned shell only into default-presentation client entry HTML and preserve byte-for-byte full-screen/assets; verify server tests distinguish both package modes and missing assets.
- [ ] 1.3 Treat authenticated extensionless HTML requests as app deep links while keeping asset misses fail-closed; verify encoded nested-path login and refresh retain the exact browser URL and content.

## 2. Unified navigation and package adaptation

- [ ] 2.1 Render the Home icon and native app switcher from the authorization-filtered catalog, refresh options on focus/visibility, and remove Admin's duplicate runtime-app list; verify unauthorized/disabled/unavailable apps remain absent and restored access appears after focus.
- [ ] 2.2 Apply isolated Featherbase visual/focus/touch styling to the runtime shell and verify the Home route reaches the existing responsive host controls without obscuring app content.
- [ ] 2.3 Mark the independent `other` fixture explicit full-screen and remove only Tasker's duplicate top-level Featherbase back link; verify Tasker's inner navigation/content and the full-screen fixture remain package-owned.

## 3. Browser and contract evidence

- [ ] 3.1 Add asymmetric browser journeys with `@spec` links for default-shell Tasker and explicit-fullscreen Other on desktop and coarse-pointer mobile, including keyboard focus/selection, Home controls, exact deep-link refresh, and authorization-filtered options.
- [ ] 3.2 Build and run focused server, web, Tasker, and browser suites plus relevant typechecks, `pnpm apps:prove`, and broader regression checks; record exact commands and outcomes.
- [ ] 3.3 Sync the accepted delta into canonical `trusted-runtime-packages`, complete code/test/spec `@spec` traceability, and pass strict `pnpm check:specs` including STC.
- [ ] 3.4 Capture and inspect representative desktop and coarse-pointer mobile screenshots, retaining directly reviewable artifacts for the PR.

## 4. Review and delivery

- [ ] 4.1 Append the dated `PROGRESS.md` outcome, inspect the final diff, and complete independent spec, test, and code review; resolve and re-review substantive findings.
- [ ] 4.2 Run Prove Before Handoff, push the issue-named branch, and open one PR linking #309 with the contract migration, compatibility risks, verification commands, and desktop/mobile visual evidence; do not merge or deploy.
