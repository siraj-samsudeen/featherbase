## Why

The owner filtered the Department list to one store, and on his next visit the filter was gone (#1228). The list already remembers its sort and columns for each person; filters lived only in the address.

## What Changes

- A table's list remembers the person's last filters, in the same server-side record as its sort and columns.
- A bare open (no filters in the address) brings them back into the address without adding a Back step. An address that names filters shows exactly those.
- The filter chips gain "Clear filters".

## Capabilities

### Modified Capabilities

- `list-view`: the list remembers its last filters.

## Impact

`apps/web` only (router's table list, ListFilters, lib/remembered-filters), over the existing `/api/user_settings` endpoint.
