## Why

Adding two filters on the same Choice column joins them with AND, so the list shows no rows
(#820). On "Section Mapping", Floor = Ground plus Floor = First Floor gives nothing, though the
user wants both the Ground and the First Floor rows.

## What Changes

- **A Choice filter picks one or more choices.** In "Add filter", a Choice column offers `in`
  and `not in`, with the column's choices as tick boxes. `in` shows rows holding any ticked
  choice; `not in` shows rows holding none of them. For Choice columns these replace `=` and
  `!=`, since ticking one choice does the same.
- **One chip per filter.** The ticked choices make one filter, shown as one chip, for example
  `floor in Ground, First Floor`, and kept in the page address as
  `["floor","in",["Ground","First Floor"]]`.
- **One filter per Choice column, and it keeps its condition.** Adding the same column again
  with `in` adds the new choices to its filter, so picking choices one at a time gives the same
  rows as picking them together. While a column has an `in` filter, "Add filter" offers only
  `in` for it, and only `not in` while it has a `not in` filter; to switch, the user removes
  the filter first.
- **The quick filter box stays a single dropdown** and writes the same kind of filter with one
  choice. When a filter with several choices is on, the box says how many are picked, and with
  a `not in` filter on it says how many are left out; picking a choice in it replaces that
  filter.
- **Filters on different columns still narrow each other**, and permissions still apply on top,
  so a filter never shows a row the user can't already see.
- Yes/No columns keep `=` and `!=`. Links and saved views that hold a Choice `=` filter keep
  working.

Not in this change: picking months for date columns, and OR between different columns.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`: a filter on a Choice column picks one or more choices.

## Impact

- `apps/web/src/components/ListView.tsx`: "Add filter" offers `in` / `not in` with tick boxes
  for a Choice column, adds to an existing filter on the same column and keeps its condition;
  the quick filter box writes `in` and shows how many choices are picked or left out.
- No server change: the server already accepts `in` and `not in`, for native Tables and for
  every data-source driver (Postgres, MySQL, DuckDB/MotherDuck, CSV).
- **Builds on #742** (PR #814), which adds the Choice dropdown in "Add filter" that this changes.
