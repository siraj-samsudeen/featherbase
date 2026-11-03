## Context

Browsing a Postgres data source asks the database for each table's columns and primary key. Columns come from `information_schema.columns`, which lists every column the login may use. Primary keys came from `information_schema.table_constraints` and `key_column_usage`, which list only constraints on tables the login **owns**. A login that reads but owns nothing therefore saw columns and no keys, and every table was refused. Foreign keys already come from `pg_constraint`, the catalogue those views are built on, for a different reason (#154: constraint names repeat across tables).

## Decisions

### Read primary keys from `pg_constraint`

Primary keys are read from `pg_constraint` (`contype = 'p'`, its column list joined to `pg_attribute`), the same catalogue the foreign keys already use.

Rejected:
- **`pg_index` with `indisprimary`** — equally visible to a non-owner, but a second catalogue for what `pg_constraint` already answers next to the foreign keys.
- **Keep `information_schema`, and tell the builder the login must own the tables** — refuses the usual way a company shares its database; the owner wants it supported (spec: "Tables connect through a login that owns none of them").

## Risks / Trade-offs

- `pg_constraint` is Postgres-specific, not standard SQL -> the driver is already Postgres-only, and its foreign keys already depend on it.
- A table the login cannot read still appears in neither list -> unchanged: browsing shows only what the login may read.

## Migration Plan

None: introspection runs on each browse; nothing is stored differently.
