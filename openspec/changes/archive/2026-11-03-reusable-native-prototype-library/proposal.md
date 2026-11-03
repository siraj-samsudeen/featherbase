## Why

Agents currently invent controls when proposing Featherbase screens, and approval can lead to rebuilding the screen for integration. A reusable, searchable library and safe starter let the owner review actual components first and retain the screen when its data comes from the server.

## What Changes

- Grow the existing component gallery into a searchable component library, with imports and working examples rather than copied markup.
- Demonstrate full-content tabs, searchable collections, breadcrumbs and return navigation under the native shell. Full content means the available content area, not the browser Fullscreen API.
- Provide a separate synthetic, resettable preview that cannot forward API requests to a live server. Exercise populated, empty, loading, error and permission-limited examples with explicit simulation labels.
- Show the actual metadata-driven list and form, plus non-Table collections using DataList and editable cell controls. Retain the same screen when using a disposable real server.
- Document the launch and reuse path for future requests in this persistent library thread.

## Capabilities

### New Capabilities

- `native-prototype-library`: discover real components, compose full-content prototypes, navigate with return context, and distinguish synthetic previews from real integration.

### Modified Capabilities

None. This increment demonstrates existing generic Table behavior; it does not redesign production forms, pickers, related panels or ListView chrome.

## Impact

Existing `apps/web/src/gallery`, real `components/ui` exports, dev-only Vite fixture configuration, acceptance tests and concise agent guidance. Use the existing React/router/query/tooling dependencies. No new backend endpoints, framework or data migrations.

Keep #795/#793/#800 ownership intact. Support #772's future catalog/mapping assembly without implementing warehouse discovery, copy or provenance features. #740 is not a prerequisite. No production fixture hooks or shell fork.
