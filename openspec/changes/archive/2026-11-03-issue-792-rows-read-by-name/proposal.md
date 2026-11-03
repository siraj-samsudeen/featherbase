## Why

People know a row by its name, but lists and the relationship map still show them ids (#792). Every list leads with Row ID, a number nobody reads a row by, even when the Table names its rows (a customer's name). A cell that links to another row shows that row's id and goes nowhere. The relationship map's row lists show linked rows as ids too, and a filter on a link reads `customer = cust-1`, in the list and again in its Recent strip.

## What Changes

- A list leads with the Table's title column (the value that names a row), as the link to the row. A Table with no title column keeps Row ID first. **This reverses #738's "Row ID first"**, agreed by the owner on 02-Nov-2026: a title is what a person reads a row by, and a Table that has one no longer shows its Row ID in the list.
- A list cell that links to another row shows that row's title and opens it.
- In the relationship map's row lists, a link cell shows the linked row's title and moves the map to that row.
- A filter, as shown in use and in the list's Recent strip, names its column as the list's heading does, and a link filter names the picked row ("Customer = Globex Ltd").
- A row with a blank name leads its list by its id; a link to it reads as the stand-in other screens use (a few of its values, or its table and id). Never a blank.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `list-view`, in the order a person meets them: a list leads with each row's title; the leading column always stays when columns are switched off; a picked link filter reads by the row's name in the filter in use and in Recent too; a filter names its column as the list does; a link cell reads as the linked row's name and opens it; a row with no name is never a blank.
- `search-and-explore`: a link in the relationship map's row lists reads by its title and moves the map. Its scenarios reuse the relationship map's volunteers and chores, whose steps exist, rather than the orders example.
- `external-data-sources`: a connected table's list no longer shows Row ID beside the title.

## Impact

- List columns (`apps/web/src/lib/list-view-columns.ts`): the title column leads; Row ID only without one. Every list that uses them (the list, the map, Explore, Peek, a row's connections) always fetches `row_id`.
- List (`apps/web/src/components/ListView.tsx`): link cells, the leading column's blank fallback, the columns menu's always-on entry, filter chips and the Recent strip.
- Relationship map (`apps/web/src/pages/RelationMap.tsx`): link cells in its row lists.
- Explore (`apps/web/src/pages/Explore.tsx`): a hash-named Table drops Row ID only when Row ID leads.
- Not here: the form's field arrangement (#795); Peek's and a row's connections' link cells keep their values.
