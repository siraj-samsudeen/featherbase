## Why

A company usually shares its own database with outside tools through a login that may read the tables but owns none of them. Connected that way, Featherbase refuses every table as having no way to address a row, so a builder cannot browse or connect anything (#782).

## What Changes

- A Postgres data source whose login owns none of its tables sees the column that identifies each row, and its tables can be connected.
- The promise is written down, so such a login stays supported.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: a Postgres data source finds each table's identifying column whether or not its login owns the table.

## Impact

- Postgres driver introspection (`apps/server/src/sources/postgres-driver.ts`): primary keys read from the database's own catalogue, as foreign keys already are.
- No change for a login that owns its tables, nor for MySQL, DuckDB or CSV sources (MySQL is not promised here: nothing tests it).
