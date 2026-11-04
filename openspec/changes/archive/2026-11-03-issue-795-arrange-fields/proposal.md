## Why

A row from a connected database is hard to read: every field is the same box, a short name sits in a tall multi-line box, the fields that only record who created or changed the row take the first places, and empty fields take as much room as filled ones. The owner asked for an easy way to change how a row's fields are laid out (#795).

## What Changes

- A row's fields can be arranged by importance, by data type, filled first, links first, or in the Table's own order, in one or two columns.
- By importance, the default, leads with what names the row, then its links, then what is required; empty fields fold into one line on a row the user only reads, and who created or changed the row moves to one line at the foot.
- Each person's arrangement is remembered for each Table. A Table its builder laid out in sections opens in that order until the person picks another.
- A row the user only reads shows each value by what it holds: a type mark by each name, numbers in even-width figures, yes or no as a marker, a link as the linked row's name, a file as its file name.
- A connected text column with a declared length is one-line text, however long the limit; only unbounded text is long text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`, first, because connecting a table is where its text columns get their kind: a text column with a declared length is one-line text.
- `core-forms`, in the order a person meets them on a row: its fields arrive by importance (or in its builder's order when laid out in sections); empty fields and who created or changed it are set aside; a read-only row shows each value by its type; the user arranges the fields another way (by data type, filled first, links first, or the Table's own order) and in one or two columns; the choice is remembered for that person and Table. "Each field gets a control that fits its type" now applies to a row the user can change.

## Impact

- Form (`apps/web/src/components/FormView.tsx`) and a new `apps/web/src/components/FormArrangement.tsx`: the arrangement switch, the arranged fields, read-only values, the footer line. The not-yet-connected note (#796) and the link picker (#793) work in every arrangement.
- Per-person settings (`/api/user_settings/:table`): a save now merges into what is stored, so the form's arrangement and the list's arrangement share one record per person and Table without overwriting each other.
- Connected tables (`apps/server/src/sources/postgres-driver.ts`, `mysql-driver.ts`): a `varchar(n)` / `char(n)` column is one-line text at any `n`; the shared row check (`packages/shared/src/schema.ts`) leaves a connected table's one-line text length to its source, which already refuses an over-long value in plain words.
- Kept compatible with #740 (the generic form stays metadata-driven, two columns by default on a wide screen) and #773 (no prototype-only hooks).
