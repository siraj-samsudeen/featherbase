# Proposal

## Why

Four small Admin bugs break everyday actions at go-live. The assign box asks for an email address but refuses one (#512). The relationship map's trail opens the wrong row (#513). A routine pinned to the home page can never be unpinned (#548). A list's sort or hidden columns can fail to save without the user being told (#546, item 1).

## What Changes

- A row can be assigned to a person by typing their email address, and the assignees read as names.
- The relationship map's trail returns to the row the user came from.
- The pinned workspace on the home page has a way to unpin it, and stays unpinned.
- When the list can't save how it's arranged, it says so.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `assignments-tags-and-rules`: a person can be named by their email address when assigning.
- `list-view`: a failed save of the list's arrangement is reported.

The relationship map and the home page pin already promise the fixed behaviour (`search-and-explore`, `dashboards-and-home-pages`), so they need no spec change.

## Impact

`/api/assign` finds a person by id or email. Web: the assign box, the relationship map, the home page's routine card and the list view. No schema, migration, permission or storage change.
