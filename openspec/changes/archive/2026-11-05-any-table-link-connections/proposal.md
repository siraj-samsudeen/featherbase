## Why

The first slice of #881 let a Decision link to a row of any Table. The linked row itself couldn't show what links to it, and one Decision couldn't list several records, because the link only worked as a single pair of fields on the row.

## What Changes

- A linked row's Connections now count the rows that link to it through a link to any Table, whether the link sits on a row or on a nested row (a Sub-table). Each connection opens exactly those rows. A Table the viewer can't read is left out, as for any connection.
- A Sub-table row can hold the pair. Its row cell waits for its Table cell, the Table cell offers only the allowed Tables, and changing the Table clears the row. Saving, delete refusal and renames already worked for nested rows in the first slice.
- The row page's own links (the drill pane, the map and the tree) include a link to any Table, pointing into the Table its row names.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: a row linked from any Table shows what links to it, and nested rows can hold such a link.

## Impact

- The list engine's via-a-Sub-table relationship filter also accepts a link to any Table, matching both its Table and its row.
