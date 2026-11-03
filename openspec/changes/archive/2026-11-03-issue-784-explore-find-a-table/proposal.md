## Why

Explore's "Start from" picker is one long list of every table, platform tables included, with no way to type to find one; and its cards show a linked row's id ("1648") where a person expects a name (#784).

## What Changes

- A search box before Explore's starting-table picker: typing narrows the list, Enter starts from the first match.
- A row in Explore shows each row it links to by its title, where the user may read that title.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-and-explore`, in the order a person meets them: finding the starting table by typing; cards showing linked rows by title.

## Impact

- Explore page (`apps/web/src/pages/Explore.tsx`): the search box; card cells render links through the shared row-title lookup.
- Row-title loader (`apps/web/src/lib/row-titles.tsx`): sends at most 100 rows per request, the server's limit, so a full pane gets its titles.
- Titles of connected rows come from #783; this change shows whatever title the lookup returns.
