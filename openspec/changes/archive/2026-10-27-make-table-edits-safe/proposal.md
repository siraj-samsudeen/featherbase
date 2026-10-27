# Proposal

## Why

Editing an existing table's definition could quietly lose a builder's data or answer with a bare error. Saving a definition that left a column out hid that column and its values with no question asked, so a partial save or a rename typed as remove-and-add made existing values unreachable (#250, #251). Marking a column unique when rows already repeat a value failed with an internal error (#510). A link column could point at a table that does not exist, leaving a table that refused every row with a value in that column (#511).

## What Changes

- A column comes out of a table's definition only when the change names it for removal. A save that just leaves a column out is refused, naming the column and how many rows hold a value in it.
- A remove-one, add-one change is never read as a rename. It is refused like any other unnamed removal; the rename action remains the way to rename a column with its values.
- Marking a column unique while its rows repeat a value is refused, naming the column and the repeated value, and the table is left as it was.
- A link column must point at a table that exists (or at its own table). A definition naming a missing table is refused, naming it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: removing a column is asked for by name; a rename is never inferred; unique over repeats and links to missing tables are refused with a message.

## Impact

`updateTable` and `createTable` in `apps/server/src/table-engine.ts`; `PUT /api/table_def/:name` gains `remove_columns`. App installs accept links between the tables of the same app. No migration: nothing stored changes shape.
