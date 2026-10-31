## Why

The quick filter boxes above a list cover only the first 4 of the Table's list columns, of text
or dropdown type (#742). Once #738 lets each user choose which columns they see, the filters
still ignore that choice: a column the user brought into view gets no box, and a column they
switched off keeps one. On a phone the boxes fill the first screen before any row shows.

## What Changes

- **The boxes follow the user's own view.** Every column the user sees gets a quick filter box
  if its type can take one, in the list's column order. Switching a column off in "Show
  columns" removes its box; switching one on adds it. No new setting.
- **Yes/No columns get a box:** a dropdown of All, Yes and No. Text and link columns keep their
  "contains" box, and dropdown columns their list of choices. Dates, numbers, money, long text,
  files and JSON still get no box; "Add filter" covers them.
- **Desktop shows one row of up to 6 boxes**, then "+N more", which opens the rest in place.
- **A phone folds every box behind one "Filters" button** that shows how many filters are in
  use. Tapping it opens the boxes stacked, so the rows start right under the toolbar.
- **A filter that holds a value never folds away**: it stays in the desktop row, and the phone
  count includes it.
- Quick filters keep writing the same filters into the page address as "Add filter", so they
  show as chips and survive a shared link.
- **A Yes/No filter matches by yes or no, not by text**, in the quick box and in "Add filter".
  Found while writing this: "Add filter" sends what is typed as text, and the server compares
  a Yes/No column with the text `"true"` without converting it, so the filter matches no row
  and shows no error (checked on 31-Oct-2026: `system = "true"` on the Table list gave 0 of 63
  rows, `system = true` gave all 63).

Not in this change: date and number range filters.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`: which columns carry a quick filter (the user's own view, by type), the Yes/No
  filter, and how many show before the rest fold away.
- `usable-on-any-device`: on a phone the quick filters sit behind a "Filters" button with a
  count, so a list's rows start on the first screen.

## Impact

- `apps/web/src/components/ListView.tsx`: `StandardFilters` reads the user's view instead of the
  Table's list columns, adds the Yes/No dropdown, the 6-box row with "+N more" and the phone
  "Filters" button. `STANDARD_TEXT_TYPES` drops `Email` and `Small Text`, types Featherbase no
  longer has.
- The Yes/No match: either the web app sends `true`/`false` for a Yes/No column (quick box and
  "Add filter"), or the server converts a filter value to the column's type; settled in design.
- No data or dependency change: the filters already travel in the page address.
- **Depends on #738** (`list-columns-from-the-table`, PR #745) for the user's own view. Build
  this after #745 merges.
