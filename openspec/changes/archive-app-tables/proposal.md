## Why

An installed app's tables can sit unused for a while, for example until the app is wired to master data. Meanwhile they show in search and navigation beside a real table of the same name, such as "Store floor" twice, and people can't tell which is real (#1041).

## What Changes

- A System Manager can archive an installed app's table, reversibly, like a custom table. The app's entry table stays refused.
- An app's table that decides access can be archived only while it holds no rows, so archiving never hides or freezes rules that are deciding someone's access. Platform security tables and custom tables that decide access stay refused.
- Global search leaves out archived tables.
- Archiving an app's table leaves its reads and scope as they were, refuses its writes, and survives a redeploy and an upgrade.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: which tables can be archived, and what archiving means for an app's table.
- `search-and-explore`: search leaves out archived tables.

## Impact

- `apps/server/src/table-archive.ts`, `apps/server/src/search.ts`, and the Archive button's rule in `apps/web/src/components/ArchiveTable.tsx`. No migration and no app version change.
