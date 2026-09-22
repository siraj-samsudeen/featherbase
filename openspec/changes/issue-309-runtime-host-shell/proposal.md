## Why

Launching a runtime application currently replaces Featherbase's entire document, so members lose the host's navigation, account, appearance, command, and responsive controls even when the package did not ask for a full-screen experience. Issue #309 closes that framework contract gap without making Tasker or another package reproduce platform chrome.

## What Changes

- **BREAKING**: runtime clients default to host-shell presentation instead of an app-owned full stage when `presentation` is absent.
- Add one strict manifest value, `presentation: "fullscreen"`, for packages that explicitly require the existing full-stage behavior; reject every other presentation value.
- Keep the app's direct root, document content, React tree, inner navigation, CSS, deep links, refresh behavior, and authentication return while the host composes reusable chrome around its client root.
- Give shell-presented runtime apps one host-owned Featherbase Home icon immediately followed by one accessible app switcher containing Featherbase Home and the current member's active authorized installed apps.
- Keep ordinary Featherbase controls reachable through the Home destination on desktop and touch/mobile, without introducing a second app list.
- Remove only Tasker's package-owned back-to-Featherbase control once equivalent host navigation exists; retain Tasker's inner workspace navigation and content.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: replace the full-stage implication of `app_owns_client_root` with explicit runtime presentation, host-shell composition, and authorization-aware switching while preserving direct-root ownership and navigation semantics.

## Impact

The strict runtime manifest and artifact identity gain one optional presentation field. Runtime HTML delivery composes host-owned shell markup, styling, and behavior for default packages while serving explicit full-screen packages unchanged. Runtime catalog entries remain the authorization source for both Admin and runtime-shell navigation. Focused server, web/browser, Tasker, package-proof, OpenSpec, and STC evidence changes; no iframe, database migration, new dependency, data-warehouse override, or build-time route/plugin work from #277.
