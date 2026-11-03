## Why

Adding two filters on the same Choice column joins them with AND, so the list shows no rows
(#820). On "Section Mapping", Floor = Ground plus Floor = First Floor gives nothing, though the
user wants both the Ground and the First Floor rows.

## What Changes

- **A Choice filter ticks one or more choices.** In "Add filter", a Choice column offers `in`,
  with the column's choices as tick boxes; it shows rows holding any ticked choice. For Choice
  columns it replaces `=` and `!=`, since ticking one choice does the same.
- **One chip per filter.** The ticked choices make one filter, shown as one chip, for example
  `floor in Ground, First Floor`, and kept in the page address as
  `["floor","in",["Ground","First Floor"]]`.
- **One filter per Choice column.** Adding the same column again opens with its current choices
  ticked and adds to that filter, so picking choices one at a time gives the same rows as
  picking them together, and a link holding several filters on one Choice column opens as one.
- **The quick filter box ticks choices too.** A tick means the choice shows. The quick box,
  "Add filter" and the chip are the same one filter, so a change in one shows at once in the
  others. Unticking every choice, or ticking every one, removes the filter.
- **Long lists stay easy.** Both tick-box lists have Select all and Clear; a list of more than 8
  choices also has a search box, and Select all then ticks only the matching choices.
- **Filters on different columns still narrow each other**, and permissions still apply on top,
  so a filter never shows a row the user can't already see.
- Yes/No columns keep `=` and `!=`. Links and saved views that hold a Choice `=` filter keep
  working and count as `in` with that one choice, so more choices can be added to them.

Not in this change: `not in` for Choice (Select all, then untick, covers leaving choices out),
picking months for date columns, and OR between different columns.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`: a filter on a Choice column ticks one or more choices, in "Add filter" and in its
  quick filter.

## Impact

- `apps/web/src/components/ListView.tsx`: "Add filter" offers `in` with tick boxes for a Choice
  column and adds to an existing filter on the same column; the quick filter box becomes a
  tick-box dropdown kept in step with the chip; both lists get Select all, Clear and, past 8
  choices, a search box.
- No server change: the server already accepts `in`, for native Tables and for every
  data-source driver (Postgres, MySQL, DuckDB/MotherDuck, CSV).
- **Builds on #742** (PR #814), which adds the Choice dropdown in "Add filter" that this changes.
