## Why

A link meant for stores has to point at Site today, and nothing stops it naming a warehouse. A saved view can't help: it is one person's list filter, which they can change or delete, and a link can't name it (#1021).

## What Changes

- A Table can be a **view**: a named filter on one base Table, kept in metadata, holding no rows of its own.
- A view has its own list page and shows its base's columns. Its rows open, and are changed, as base rows, under the base's access. A view never has grants, access policy or Data Scopes of its own.
- A link column can name a view. Its picker offers only the view's rows, and saving a new value outside the view is refused. The link stores the base row's id, so a column can move between the base and its views without changing data.
- A row that leaves the view keeps the links that already name it, and the linking row shows that the value is outside the view.
- A link to a view counts as a link to its base wherever links are followed: delete blocks, row renames, backlinks, purges and activity.
- The base keeps the columns a view filters on, can't be deleted while it has views, and a rename of the base carries its views along.

## Capabilities

### New Capabilities

- `table-views`: views of a Table, and links that name them.

## Impact

- Server: one resolver (`apps/server/src/views.ts`) that read, permission and link paths call first; the row-write gate refuses writes to a view; metadata-only branches in the Table engine.
- Migration `0153_table_views.sql`: `table_def.view_of` and `table_def.view_filters`.
- Web: a view's list page and banner, "New view…" on a filtered list, view names in link column editors.
- No app version change. The warehouse copy is unaffected: a view has no relation to copy.
