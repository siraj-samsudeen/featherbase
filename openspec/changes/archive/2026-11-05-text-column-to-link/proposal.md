## Why

Jeyarama's Plant table mirrors SAP's plant master, so its codes arrive as text: sales org `1150`, division `10`,
state `32` (#911). People should never see a bare code; each one should link to its master (Sales Org, Business
Line, State) and show that row's name. The masters now exist, and their ids are those same codes, so every value
already names a real row.

A column's type can't change today. The only way round is to add a new link column, copy the values across, and
remove the old column. That loses the column's history and protected corrections, such as a person's fix to plant
8151's state (#865), and it breaks the SAP import's column mapping.

## What Changes

- A text column can become a link to another table once every value in it names an existing row of that table.
  If any value doesn't, the change is refused and the refusal lists those values.
- A link column can always become a text column again.
- The column keeps its name and every value, so its history, protected corrections and import mapping stay
  attached. Nothing is copied or converted, because both kinds store the same text.
- The Columns screen offers **Turn into a link** on a text column. An app version can make the same change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a column's type is fixed once created, except text to link (when every value matches) and
  link to text.
- `trusted-runtime-packages`: an app upgrade may make the same two changes.

## Impact

- `apps/server/src/table-engine.ts`: `updateTable` and `changeColumnType` accept Data → Reference after checking
  the values, and Reference → Data.
- `apps/server/src/runtime-migrations.ts`: an `alterColumn` step passes the new link's table.
- `apps/web/src/pages/ColumnEditor.tsx`: the **Turn into a link** action.
