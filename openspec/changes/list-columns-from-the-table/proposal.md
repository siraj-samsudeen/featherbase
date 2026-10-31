## Why

Importing a 7-column sheet into a new Table gave a list showing Row ID and only the first 4
columns, and no screen could add the other 3 (#738). The row page showed all 7, so it looked
like data had gone missing. The only fix was a hand-made Metadata Override, found by reading
server code. A list that hides columns with no way back blocks go-live (#566).

## What Changes

Which columns a list shows becomes a **Table setting** the user can see and change, with each
user free to adjust their own view on top of it.

- **"Show columns" offers every column**, not only the list's. The Table's list columns come
  first, ticked; the rest follow under "Not in the list by default", unticked. Ticking or
  unticking changes only that user's view of that Table and is remembered.
- **A user's saved view records columns they add, not only ones they hide.** A column someone
  hid before this change stays hidden for them.
- **"Make this the default for everyone"** at the foot of the menu, for people who can manage
  the Table. It makes their current view the Table's list columns; other users' own additions
  and hidings stay on top.
- **The menu's button looks pressed while open** (accent tint, chevron up). This is the shared
  dropdown-button style, so other dropdowns that report open/closed get it too.
- **Import Wizard, new Table:** the column step gets an "In list" tick per column, the first 7
  columns in use ticked by default, "Tick all" and "Clear" above it. A column left out of the
  import is out of the list too. (Today it silently ticks the first 4.)
- **Edit columns page:** an "In list" tick per column, saved at once, for everyone.
- **Phone:** a list card shows at most 3 column lines (title, status and row ID don't count),
  then "N more", which opens the rest in place.
- **Table Builder default** goes from the first 4 columns to the first 7, to match import
  (to confirm with the owner in the specs step).

Not in this change: quick filters (#742, blocked by this one).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: a new Table, built or imported, starts with its first 7 columns in the
  list, chosen before creating it; a System Manager can change the list columns later; that
  choice joins the builder authority.
- `list-view`: says which columns a list shows; each user can switch any readable column on or
  off for themselves, and it is remembered; a System Manager can make their view the default.
- `usable-on-any-device`: phone cards show at most 3 listed columns, then "N more".

(A new Table from a file is already Tables and Fields' ground, per Spreadsheet Import's
Purpose, so the import's "In list" choice is specified there.)

## Impact

- `apps/web`: `ListView.tsx` (menu, saved view, make-default), `lib/meta.ts` (`listColumns`),
  the shared dropdown button in `components/ui`, `DataCards` (phone cap), `ImportWizard.tsx`
  (column step), `ColumnEditor.tsx` (In list tick), `TableBuilder.tsx` (default 7).
- `packages/shared/src/import.ts`: `inferTableDef` default from 4 to 7.
- `apps/server`: the per-user list settings gain added columns beside hidden ones; setting a
  column's `in_list_view` after creation needs a write path for managers (existing column
  update or Metadata Override, settled in design).
- No new dependency. Existing per-user settings stay valid: a stored list of hidden columns
  still means the same thing.
- The 3 stopgap Metadata Override rows on Section Mapping MCH (`jeyarama/dash`) are left alone.
