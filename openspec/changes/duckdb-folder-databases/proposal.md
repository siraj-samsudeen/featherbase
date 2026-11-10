## Why

A public demo instance should show Dash's figures without a real warehouse. Dash's queries read two warehouse databases at once, as MotherDuck serves them, but a local DuckDB warehouse source opens a single file. Letting a local source read several database files makes a small made-up warehouse on disk behave like MotherDuck, so the demo, and anyone developing without a MotherDuck account, runs the same queries production runs (#1123).

## What Changes

- A DuckDB warehouse source may point at a folder and name the databases it reads, as a MotherDuck source does. Each named database is read, only ever read, from the file of that name in the folder.
- A named database with no file fails the connection test and names the missing database.
- A source pointing at one file keeps working as it does today.

## Capabilities

### Modified Capabilities

- `external-data-sources`: a local warehouse file source can read several databases.

## Impact

- The DuckDB driver and the data source checks in `apps/server`.
- Used by the public dev demo's made-up warehouse (#1123).
