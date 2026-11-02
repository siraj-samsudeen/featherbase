## Why

A company's own database is usually shared with outside tools through a read-only login that owns none of the tables. Connected that way, Featherbase refuses every table as having no way to address a row, so a builder cannot browse or connect anything (#782).

## What Changes

- A Postgres data source reached through a login that can read the tables, but owns none of them, sees each table's key and can connect it.
- The promise is written down, so a read-only login stays supported.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: browsing a data source finds each table's key whether or not the login owns the table.

## Impact

- Postgres driver introspection (`apps/server/src/sources/postgres-driver.ts`): primary keys read from the database's own catalogue, as foreign keys already are.
- No change for MySQL, DuckDB or CSV sources, nor for a login that owns its tables.
