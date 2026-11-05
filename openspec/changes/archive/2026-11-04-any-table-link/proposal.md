## Why

A Decision should point at the exact records it shapes, such as Business Unit PKN-GOLD or Plant 8151, which live in different Tables. A link column today points at rows of one fixed Table, so the only options were typed text (not clickable, not checked) or one link column per Table (#881).

## What Changes

- A link column can take its Table from another column of the same row. That column is a link to Table: two visible fields, the Table first and then its row, as the owner approved on 3-Nov-2026.
- The column lists the Tables it allows. A Sub-table, a settings Table or a Table kept in a connected database is never allowed. When no Tables are listed, any Table that stores rows is allowed.
- A save checks that the row exists in that Table. A new or changed link must also be to a row the person saving can read.
- A linked row can't be deleted. Renaming the row, renaming its Table or renaming the Table column keeps the link.
- A Table that a link allows, or that a link points into, can't be deleted.
- On a form, the row is picked after its Table and is shown by its title, with a way to open it. A row the reader can't read shows as "<Table> (no access)", with no way to open it. A list shows the row's title as a link.
- The column editor adds both columns together, as "Link to a row of any Table".

This is the first slice. Sub-table use and the linked row's Connections panel come next, in a separate change.

## Capabilities

### Modified Capabilities

- `tables-and-fields`: a link column can point at a row of any Table.

## Impact

- `apps/server`:
  - migration `0141_any_table_link.sql`
  - `any-table-link.ts`
  - `document.ts` (the save check, delete blocking and row renames)
  - `document-activity.ts`
  - `table-engine.ts` (definition checks, Table rename and delete, column rename)
  - `meta.ts`
- `apps/web`:
  - the form's link control
  - the list cell
  - the column editor
