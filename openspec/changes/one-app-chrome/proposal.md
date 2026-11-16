## Why

The top bar and left sidebar kept drifting between Featherbase Admin, the account pages and the installed apps (#1227). The account pages showed a plain name with no application switcher. Only the Admin's sidebar could be collapsed (#1018) or became a drawer on a phone, and each app chose its own sidebar width. The owner wants one chrome, built once.

## What Changes

- The shared top bar shows the application switcher on every signed-in page, the account pages included. It names the address's app, the app the person belongs to, or a neutral "Featherbase".
- The sidebar's state (collapsed per person in this browser, the phone drawer) is one shared state. The top bar draws its controls on every page that has a sidebar, and Ctrl/Cmd+B works there, except while typing.
- `<featherbase-sidebar>` takes the Admin sidebar's behaviour: 240px wide, no width when collapsed, and a 256px drawer with a backdrop below 768px. Apps give it an `auto` column.
- Dash, Tickets, Tasker and Equipment change only their shell grids, so each gets a new version.

## Capabilities

### Modified Capabilities

- `app-navigation`: every page shares one top bar and sidebar.

## Impact

`apps/web` (TopBar, AppSwitcher, AdminLayout, lib/sidebar-collapsed, bar/sidebar). Each app's shell CSS and its version. No server, permission or data change.
