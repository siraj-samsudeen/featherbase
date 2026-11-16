## 1. Shared chrome

- [x] 1.1 One sidebar state (lib/sidebar-collapsed): collapsed per person in this browser, the drawer, Ctrl/Cmd+B and Escape.
- [x] 1.2 The top bar draws the switcher on every signed-in page and the sidebar controls wherever a sidebar is present; Admin uses them instead of its own.
- [x] 1.3 `<featherbase-sidebar>` takes the Admin sidebar's width, collapse and phone drawer.
- [x] 1.4 Dash, Tickets, Tasker and Equipment give the sidebar an `auto` column, each with a new version.

## 2. Verification

- [x] 2.1 Unit tests: each app's sidebar collapses with the control and Ctrl/Cmd+B, not while typing; the phone drawer; the account pages' switcher.
- [x] 2.2 The change's scenarios run against Tasker's and Dash's real pages.
- [ ] 2.3 An independent verifier compares before and after at desktop and phone width for Admin, the account pages and each app.
