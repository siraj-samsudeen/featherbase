## Why

The UX standard (dash-reports item 13) leaves the app switcher with only the apps a person can open: a greyed "Tasker: you need the Tasker Member role" is a dead item in a menu for going somewhere. The manager decided this under the owner's standing mode (16-Nov-2026, option A of #1236's question). A System Manager still needs to see who an app opens for. That belongs on Admin → Apps, where apps are managed.

## What Changes

- The app switcher lists only the apps the person can open, for everyone, System Managers included.
- Admin → Apps names, on each installed app, the roles that open it ("Opens for: Tasker Member").
- This replaces #1008's greyed entries in a System Manager's switcher. Who can open an app does not change.

## Capabilities

### Modified Capabilities

- `app-management`: a System Manager learns who an app opens for on the Apps page, not in the switcher.

## Impact

`apps/web` (AppSwitcher, the Apps page). `/api/app_catalog/closed` stays as it is: the switcher stops reading it. It is its own commit, so the owner can overturn it.
