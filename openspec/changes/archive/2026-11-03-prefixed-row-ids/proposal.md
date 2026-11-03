## Why

On staging the owner wanted plant row ids such as `PLANT-8151`: a fixed prefix
plus the row's own SAP code (#858). No naming rule did this. Naming rows after
the plant code gave `8151`, a series gave `PLANT-0047`, so `PLANT-8151` meant
typing the id on every row.

## What Changes

- A naming rule that puts fixed text before one column's value, stored as
  `PLANT-{plant_code}`. A row gets its id from it on create, from the form, an
  import or the API.
- The column is required. A second row with the same value is refused with a
  message that names the column, for this rule and for naming after a column
  alone.
- Changing the column later keeps the row's id. The form says so and offers
  Rename to the id the rule gives now, so links and addresses stay intact.
- The builder and a Table's Naming page take the prefix beside the column pick
  and show a sample id.
- Renaming the column carries the rule with it.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `naming-and-numbering`: a prefix plus a column as a naming choice; a
  duplicate value is refused naming the column; an out-of-step id is offered
  for Rename.

## Impact

`resolveRowId` (document.ts) and `validateIdPattern` (table-engine.ts) learn the
rule; column renames in table-engine.ts and runtime-migrations.ts rewrite it.
The web naming control and the form read it through `namingColumn` in the
shared package. No data migration: existing rules are unchanged.
