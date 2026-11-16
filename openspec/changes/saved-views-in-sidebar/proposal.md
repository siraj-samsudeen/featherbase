## Why

The owner saved a shared view and expected it in the left sidebar, but a saved view showed only on its own table's list (#1229).

## What Changes

- The Admin sidebar gains a "Saved views" group. It lists the user's own views on every table, and shared views of others that the user starred, on tables the user can read.
- A shared view of someone else carries a star on its chip, which adds it to the sidebar or removes it.
- New read `GET /api/saved_views/sidebar`. Stars are kept in the user's navigation settings.

## Capabilities

### Modified Capabilities

- `saved-views`: saved views are reachable from the Admin sidebar.

## Impact

`apps/server` (saved-views read and route), `apps/web` (SavedViewsBar star, nav-settings, AdminLayout sidebar), and one icon added to Shop Floor's curated set.
