## Why

Search or Command (the sidebar's field and the ⌘K / Ctrl+K command bar) existed only in the Admin. On Dash, Tasker and Tickets pages there was no way to search or jump anywhere (#1385, slice 1 of the shared sidebar). The command bar's inventory was also an Admin one, refused outright to anyone who cannot use the Admin.

## What Changes

- The command bar becomes one shared component. The shared top bar draws its field at the top of every page's sidebar, the Admin's and every app's, with the same ⌘K / Ctrl+K.
- It offers only what the viewer can open:
  - `/api/command_destinations` gives someone who cannot use the Admin their apps, the apps' tabs and their account pages, and no Tables or Admin pages.
  - For them the bar runs no record search, suggests no Table or new row, and lists no Admin-only commands.
- Someone who can use the Admin finds what they found before, on an app's page too, where an Admin destination opens with a full page load.
- Ctrl+Shift+K stays View As's. The Admin keeps Ctrl+S, `g d` and `g n`.

## Capabilities

### New Capabilities

### Modified Capabilities

- `app-navigation`: every page offers Search or Command.
