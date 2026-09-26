## 1. Manifest and host composition

- [x] 1.1 Keep the strict runtime manifest unchanged and compose the host-owned shell into every runtime client entry HTML response.
- [x] 1.2 Preserve secondary HTML and non-HTML assets byte-for-byte while limiting deep-link fallback to an app-root base; verify server tests distinguish entry composition from secondary documents and missing assets.
- [x] 1.3 Treat authenticated extensionless HTML requests as app deep links while keeping asset misses fail-closed; verify encoded nested-path login and refresh retain the exact browser URL and content.

## 2. Unified navigation and package adaptation

- [x] 2.1 Render the Home icon and native app switcher from the authorization-filtered catalog, refresh options on focus/visibility, and remove Admin's duplicate runtime-app list; verify unauthorized/disabled/unavailable apps remain absent and restored access appears after focus.
- [x] 2.2 Apply isolated Featherbase visual/focus/touch styling to the runtime shell and verify the Home route reaches the existing responsive host controls without obscuring app content.
- [x] 2.3 Remove only Tasker's duplicate top-level Featherbase back link and adapt its fixed mobile detail surfaces to the host inset while preserving its inner navigation and content.

## 3. Browser and contract evidence

- [x] 3.1 Add asymmetric browser journeys for shell-presented Tasker on desktop and coarse-pointer mobile, including keyboard focus/selection, Home controls, exact deep-link refresh, and authorization-filtered options.
- [x] 3.2 Build and run focused server, web, Tasker, and browser suites plus relevant typechecks, `pnpm apps:prove`, and broader regression checks; record exact commands and outcomes.
- [x] 3.3 Sync the accepted delta into canonical `trusted-runtime-packages` and pass strict OpenSpec validation under the repository's current baseline.
- [x] 3.4 Capture and inspect representative desktop and coarse-pointer mobile screenshots, retaining directly reviewable artifacts for the PR.

## 4. Review and delivery

- [x] 4.1 Append the dated `PROGRESS.md` outcome, inspect the final diff, and resolve material implementation findings.
- [ ] 4.2 Run Prove Before Handoff, push the issue-named branch, and open one PR linking #309 with the contract migration, compatibility risks, verification commands, and desktop/mobile visual evidence; do not merge or deploy.
