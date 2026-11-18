## Why

Explore was the only way to follow links between Tables: an admin-only page of dropdown chains,
apart from the list people work in. Relational navigation (#1218, slice 5, #1276) moves that job to
the list itself: "Add filter" follows links, every link cell can go there or filter, and Explore
retires.

## What Changes

- Add filter gains **Linked to…** and **Not linked to…**. Pick a Table the list links to (its links,
  the Tables linking to it, the far side of a link Table, a sub-table), then rows of it, searchable,
  each with how many rows it links to. A step may be linked on to another Table, so Explore's chains
  are built from the list; each step shows its count. The filter is one relationship filter in the
  list's address and its saved views.
- The list shows the exact sum of its money (or other measure) column, as Explore's panes did.
- The server's relationship filter follows back-links (`['row_id', 'related', { table, column }]`),
  and `not related` takes every shape, an empty link counting as not linked. Every step stays scoped
  to what the reader may read.
- Every link cell in a list offers **Go there** and **Filter** on hover, the record panel's chip
  actions (one `LinkActions` in shop-floor).
- **Explore is retired**: its sidebar entry and list button go, and an old Explore address opens the
  list its chain reached, filtered by Linked to steps.

## Capabilities

### Modified Capabilities

- `search-and-explore`: Explore's requirements are removed; Linked to filters and the old-address
  redirect are added.
- `external-data-sources`: following links within one connected Postgres source is the list's
  Linked to filter, not Explore.
- `list-view`: link cells offer Go there and Filter.

## Impact

- `apps/server/src/query.ts`, `related-filter.ts`, `sources/dispatch.ts`.
- `apps/web`: `lib/linked-filters.ts`, `components/LinkedFilter.tsx`, `ListFilters.tsx`,
  `ListRows.tsx`, `ListView.tsx`, `lib/nav-path.ts`, `router.tsx`, `AdminLayout.tsx`; Explore's page,
  steps and split button are deleted.
- `packages/shop-floor`: `LinkActions`. `packages/shared`: Explore leaves the admin page catalog.
- The active change `issue-910-relational-navigation` no longer modifies Explore's requirement.
