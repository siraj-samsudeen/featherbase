## Why

On a list page the Admin sidebar takes 240px, so a wide table scrolls sideways. The owner asked for the sidebar to be collapsible, ideally on `Cmd+B` or `Ctrl+B` (#1018). That key used to start a new row.

## What Changes

- A control in the top bar, `Cmd+B` and `Ctrl+B` collapse and reopen the Admin sidebar at desktop width, remembered per person in that browser.
- A Table's list no longer stops at the 1024px reading width of other pages, so a wide table gets the whole page, with the sidebar open or collapsed.
- The shortcut is left to the field while the cursor is in a text field or rich-text editor.
- The new-row shortcut moves to `g then n`, beside `g then d`.
- A phone keeps its drawer, unchanged.

## Capabilities

### Modified Capabilities

- `admin-ui-feedback`: the sidebar can be collapsed. The new-row shortcut's requirement names no key, so it stands as written.

## Impact

- `apps/web/src/pages/AdminLayout.tsx`, `apps/web/src/router.tsx`, a small `lib/sidebar-collapsed.ts`, two icons exported from `packages/shop-floor`. No server, schema or app version change.
