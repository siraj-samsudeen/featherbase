## Why

Testing Dash on staging while viewing as a Store Manager (17/18-Nov-2026), the owner found the shared sidebar letting them down: in the rail its foot drew Help and Theme outside it, Collapse did not always stick, its menus were drawn under a report's table header. The owner also wants the sidebar adjustable, like Claude's, and the collapse key named on hover rather than taught by a pop-up tip.

## What Changes

- The collapsed choice is the signed-in person's, the one at the keyboard, even while they view as someone else. The bar's foot and every sidebar read the same choice, so the foot never draws outside the rail.
- Open, the sidebar's edge drags its width from 200 to 360 pixels, kept for the person like the collapsed choice; a click on the edge still folds it.
- In the rail every control of the sidebar's top and foot stays (the avatar, Help and Theme stacked), each named on hover; the Collapse control names its key there, open or folded. The key is no longer drawn on the Collapse row.
- The sidebar's menus and hover labels show above the page, whatever the page draws.
- The Theme menu is a short list, an icon and a name on each row and a tick on the one in use.
- Collapsing the sidebar by mouse no longer pops up a tip. Other shortcuts (Ctrl+K) still teach theirs.

## Capabilities

### Modified Capabilities

- `app-navigation`: three requirements added: the sidebar keeps the signed-in person's choices, its width is the person's own, and its rail keeps every control, named on hover, with its menus above the page.
- `keyboard-shortcuts`: the sidebar's key is named on hover and never taught by a tip; the tip and reminder scenarios use the search shortcut.

## Impact

- `apps/web/src/lib/sidebar-collapsed.ts` (the store, the edge), `lib/sidebar-rail.ts` (hover labels), `lib/shortcuts.ts`, `bar/sidebar.ts`, `pages/AdminLayout.tsx`, `components/TopBar.tsx`.
- No server or data change.
