## Why

Every link to a Table's rows reads "name · code", whatever suits that Table (#1020). A Cluster's code adds nothing beside its name; a store's code is often what people say.

## What Changes

- Each Table chooses how links to it read: Name (code), the default; Code (name); Name only; Code only. Brackets replace the dot.
- The choice applies wherever a link shows, and a row with no separate code still shows its name. Generated ids are never shown.
- `/api/table_def` takes `link_format`, on its own or with the definition.
- The Table's settings page offers the four formats, with a preview from a real row.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: a Table's link format.
- `list-view`: a link in a list reads by that format.

## Impact

- A platform migration adds `table_def.link_format`. Server, web and `packages/shared`. No app version change: no app's files change.
