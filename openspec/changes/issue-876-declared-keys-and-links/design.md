## Context

Reflect learns two facts from a source's introspection: a table's single-column primary key (`pk`) and, per column, the foreign key it carries (`references`). Everything readable about links follows from those two facts: a column whose reference lands on a connected table's key becomes a Reference (`buildBoundTable`), and the raw edge is recorded so the other connection order converges (`linkReferencesTo`). Postgres and MySQL report both facts; DuckDB/MotherDuck reports neither, and reflect falls back to a duckdb table's first column as its key. Since #808 an app's `reflect.tables` entry carries per-table settings (`leave_out_columns`, `title_column`, `list_columns`), validated against the source before anything is created.

```mermaid
flowchart LR
  I[Driver introspection: pk, references] --> O[Overlay app's key + links]
  S[App table settings: key, links] --> V{agree with source? columns exist? targets exist?}
  V -- no --> X[install refused, nothing created]
  V -- yes --> O
  O --> R[Existing reflect: candidate, Reference columns, recorded edges]
```

## Decisions

### Key and links are two more table settings, laid over introspection

`{ table, key?, links?: { <column>: <table> } }`. Before a requested table is built, its introspected `pk` is replaced by `key` and each linked column's `references` is set to the target table's key. Nothing downstream changes: the same code that turns a real foreign key into a Reference turns a declared one into a Reference, in either connection order.

A link names a table, not a table and column: the target is that table's key (its declared `key`, else its source's primary key, else, on duckdb, the first-column fallback). A Reference holds one value that must address one row, so any other target column could not be a Reference anyway.

Rejected:
- **A separate `keys`/`links` section on the source** — the same parallel-maps objection #808 recorded: one table's description spread over several places.
- **Link to an arbitrary target column** — cannot become a Reference; it would be a promise the platform can't keep.

### A declaration agrees with the source or refuses the install; it never overrides

A key on a table whose source declares a different primary key, or a link on a column whose source declares a different foreign key, refuses the install. A declaration that matches is accepted. So the live StyleHR app can carry the same key and links as the warehouse one, and a source that later gains real constraints can never be silently contradicted by an app.

Rejected:
- **Declaration wins** — would let a manifest bind rows by a non-unique column on a source that knows better.
- **Refuse any declaration on a source that declares keys** — forces two different table descriptions for the same tables, which then drift.

### Every key and link is checked with the other settings, before anything is created

A key or link column must be on the table and not left out; a link's target must be a table on the source and allowed by its allow-list, and must have a key. Errors join #808's settings errors, so one install reports them all and creates nothing.

### The warehouse StyleHR is a sibling app with identical table settings

`client-apps/jeyarama/stylehr-warehouse/app.json` reads `bronze_stylehr.public` through a MotherDuck read-scaling token in `STYLEHR_WAREHOUSE_URL`; its `reflect.tables` equals the live app's. A server test fails if the two differ. Both use the same Table names, so an instance installs one or the other.

Rejected:
- **One app with two sources** — two sets of thirteen Tables under different names on one instance.
- **Choosing the source by environment at install** — a new install-time switch for one client's need.

## Risks / Trade-offs

- A declared key that is not actually unique gives rows that open as the first match -> the warehouse StyleHR keys (`id`) were checked unique on 03-Nov-2026; a declared key is the app author's promise, as the first-column fallback is today.
- The warehouse copy keeps rows the HR system deleted and is as old as its last load -> stated in the app's README; out of scope here.
- An instance can't hold both StyleHR apps -> the install refuses on the first clashing Table name; the README says to choose one.
