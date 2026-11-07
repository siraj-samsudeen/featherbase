## Why

Checking master tables in Admin after go-live turned up four small breaks: **What can I see?** drops the Admin frame and says "they" on your own page (#1006), a System Manager can't tell an app is installed when they lack its role (#1008), the arrange toolbar jumps when one column is chosen (#1012), and a list page says its name three times because of a path bar with one step (#1013).

## What Changes

- Someone who can use Admin reads their account pages in the Admin frame, where Admin is. Everyone else, and anyone on an app's own address, keeps the plain top bar.
- A person's own access page says "you" throughout.
- A System Manager's app switcher lists installed apps they can't open, greyed out, with the roles that would open them.
- One-column arrangement narrows the fields only, so the toolbar stays where it was.
- The path bar shows only once there is a real path of two or more steps. On one step, a person with remembered paths still sees Recent paths alone.

## Capabilities

### Modified Capabilities

- `access-explanation`: the frame and the wording of the page.
- `app-management`: installed apps a System Manager can't open.
- `record-workspace`: when the path bar shows.
- `core-forms`: the arrange toolbar stays put.

## Impact

- `apps/web` pages and components, and one new read-only endpoint, `GET /api/app_catalog/closed`, for System Managers. No schema or app version change, and what opens an app is unchanged.
