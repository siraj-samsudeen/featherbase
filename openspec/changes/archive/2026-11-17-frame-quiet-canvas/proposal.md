## Why

The owner is restyling Featherbase after Front's app (#1253). Agreed on 17-Nov-2026: no top bar, the sidebar on a grey canvas with the work in a white panel, a "Search or Command ⌘K" field at the top of the sidebar, and the account, help and theme at its foot, with as few lines as possible.

## What Changes

- A page with a sidebar (the Admin, the account pages, every app's `<featherbase-sidebar>`) has no top bar on a wide window. The shared bar draws the application switcher and the notification bell at the sidebar's top, the "Search or Command" field under them, and the account, help and theme at its foot, above the Collapse row. In the rail: the logo, a magnifier, the avatar.
- The command bar opens as a wide box in the middle of the screen, from the field or `Ctrl+K` / `Cmd+K`.
- At phone width a slim header keeps only the menu button that opens the drawer.
- Quiet Canvas: the sidebar has no fill, border or dividers; the page is one white panel with rounded corners and a soft shadow; group titles are small, grey and regular weight; the open page is a white tile.
- An app's declared bar pickers (Dash's Store and Month) keep a slim strip above the app's page.

## Capabilities

### Modified Capabilities

- `app-navigation`: the shared chrome is the sidebar; there is no top bar beside it.

## Impact

`apps/web` (TopBar, AppSwitcher, AdminLayout, AccountLayout, SidebarRail, DataSourcesSidebar, lib/sidebar-collapsed, bar/sidebar). No app version changes: the platform styles the app's page column. No server, permission or data change.
