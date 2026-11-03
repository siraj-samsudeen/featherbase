## Why

Connecting an outside database's tables gives defaults a builder then fixes by hand, table by table: no column names a row, so links fall back to whatever value comes first; a list shows the source's first four columns, which are often when a row was created and who changed it; and a column pointing at a table not connected yet shows a bare number with no hint that connecting that table would make it a link (#796).

## What Changes

- Connecting a table makes its name column (the first it has of name, title, label, full name, display name, first name) the value its rows are read by.
- Its list shows that column and up to four more, in the source's order, never its key or the columns that only record when a row was created or changed and by whom.
- A column that points at a table not connected yet says so beside its value; a System Manager is offered to connect that table, which opens the data source's Browse screen with it already chosen.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`, in the order a person meets them: connecting a table picks the column that names its rows; its list shows what a row is about; a link to a table not connected yet says so; a System Manager can connect that table from the row.

## Impact

- Reflect (`apps/server/src/sources/reflect.ts`): picks the title column and the list columns.
- Form (`apps/web/src/components/FormView.tsx`): the note and the offer beside an unlinked column.
- Browse screen (`apps/web/src/pages/SourceBrowser.tsx`, its route): opens with a table chosen and loaded when asked.
- Not here: choosing the name on the Browse screen (delivered by #783); text types for character columns (#795); renaming and labels (#777).
