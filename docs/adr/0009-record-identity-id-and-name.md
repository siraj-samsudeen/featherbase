# ADR 0009: Record identity — `id` and `name`, and the column naming convention

**Status:** Accepted · **Date:** 2026-07-31

> Renumbered 0007 → 0009 on 2026-08-11: this ADR was filed as 0007 while
> [ADR 0007](0007-app-and-database-topology.md) already held that number, so
> "ADR 0007" was ambiguous. Entries in `PROGRESS.md` dated before this and
> [#89](https://github.com/siraj-samsudeen/featherbase/issues/89)'s title still
> say "ADR 0007" — those are dated records, left as written.

## Context

Every generated table's primary key column is literally called `name`:

```
"name" varchar(140) primary key
```

(`createTableDDL` in [apps/server/src/doctype-engine.ts](../../apps/server/src/doctype-engine.ts).)
`name` also heads `STANDARD_COLUMNS`, so a user column may never be called
`name` — it is a reserved word.

This is inherited from Frappe, where a document's primary key is `name`. It
means the word "name" denotes *identity*, and the platform has no column left
for the human-readable name of a thing. Every table that needs one must invent
a user column for it.

The cost shows up the moment real data arrives. A `Zone` sheet imported from a
source system carries `zone_id` and `zone_name` as ordinary data columns, while
the actual primary key sits in a third column called `name` holding
`a0373bac75`. Three columns, two of which are about identity, and the one
called "name" is the one that is not the name. The list view compounds it:
`listColumns` ([apps/web/src/lib/meta.ts](../../apps/web/src/lib/meta.ts))
hardcodes `label: 'Name'` for the key column, so the grid header reads "Name"
above a column of hashes.

The classical model users arrive with is simpler: **a record has an ID and a
name.** An employee has an employee ID and an employee name; a zone has a zone
ID and a zone name. The schema should say that directly.

Two questions follow, and this ADR settles both.

1. What is the primary key column called?
2. When the platform generates standard columns, are they bare (`id`, `name`)
   or domain-prefixed (`employee_id`, `employee_name`)?

[ADR 0006](0006-stack-react-hono-postgres.md)'s addendum already records that
Frappe wire-format compatibility is **not a goal** and that Frappe's vocabulary
has been deliberately replaced. Migration `0055_terminology_rename` is the
precedent: `sort_field` → `sort_column`, DocType → Table, docfield →
`column_def`. This decision is the same kind of move, applied to the one piece
of Frappe vocabulary that is most load-bearing and most confusing.

## Decision

### 1. The primary key column is `id`

`name` is freed to mean what everyone expects: the human-readable name of the
record, an ordinary user column that a table may or may not have.

`id` replaces `name` in `STANDARD_COLUMNS`, in the generated DDL, in
parent/sub-table linkage, in Reference columns (which store a target record's
key), in RLS policies, and across the API surface.

### 2. Platform-generated columns are bare and uniform; never domain-prefixed

| Layer | Convention | Example |
|---|---|---|
| Platform columns | bare, uniform, never prefixed | `id`, `name`, `created_at`, `status` |
| User columns | exactly what the source or user calls them | `zone_id`, `zone_name` |
| Labels | carry the domain word, freely overridable | "Zone ID", "Employee Name" |

The deciding argument is not style, it is that these columns are *generated*.
The engine emits them for every table without knowing the domain. `id` can be
generated uniformly; `employee_id` would require interpolating the table name
into the column name, which then has to be rewritten whenever a table is
renamed, stutters at every call site (`employee.employee_id`), and makes
generic code impossible — `listColumns` can only hardcode the key column
because that column's name is table-independent.

User columns are left exactly as the source names them. A sheet's `zone_id`
column stays `zone_id`; the platform does not strip prefixes it did not add.
Stripping would be lossy and surprising, and `zone_id` (the source system's
identifier) is genuinely a different fact from `id` (this platform's key).

Clients override at the **label** layer, which is free text and already
per-column.

### 3. A file column called `id` or `name` is resolved, not rejected

Because both are reserved, a spreadsheet with an `id` or `name` header
currently fails to import. On import such a column must either be mapped onto
the record's `id` or be auto-suffixed (`id_2`), never rejected outright.

### 4. An `id` sourced from imported data is validated before the write, never
patched silently

The existing `field:<column>` id pattern names a record from another column's
value (`resolveName` in [apps/server/src/document.ts](../../apps/server/src/document.ts)).
Applied to an import, two failure modes appear: blank values and duplicates.

There is **no silent fallback**. Mixing `40003` and `a0373bac75` in one table
recreates precisely the problem this ADR removes, and does it invisibly. The
Import Wizard's existing **Check** step is the place to catch it: blanks and
duplicates are reported *before* any row is written, and the user chooses
explicitly — fill the gaps from a series, skip those rows, or cancel.

## Consequences

**Gained.** The schema matches the mental model users bring: a record has an ID
and a name. `name` becomes a real, labelable column, which removes the need for
a separate `id_label` field on `table_def` — "Zone ID" and "Zone Name" fall out
of the existing per-column label. Imported sheets stop carrying a third,
redundant identity column.

**Cost.** This is a wide mechanical rename plus a migration. At the time of
writing it touches the primary key in the DDL generator, `STANDARD_COLUMNS`,
48 files under `apps/server/src`, 14 routes keyed on `:name`, parent /
`parenttype` / `parentfield` sub-table linkage, every Reference column value,
the RLS policies, the web client's meta and view layer, and most of the test
suite. It is mechanical rather than subtle, but it is not small, and it must
land as one piece of work with its own migration — not folded into an unrelated
change.

**Compatibility.** None is preserved. Consistent with ADR 0006's addendum,
Frappe wire-format compatibility is not a goal, so `name`-as-primary-key is not
retained as an alias. Existing databases are migrated.

**Deferred.** The `title_column` field on `table_def` overlaps conceptually with
a `name` column once `name` means what it says. Whether `title_column` survives
this change, or collapses into a convention that `name` *is* the title when
present, is left open and should be settled when the rename is implemented.

## Alternatives considered

| Option | Rejected because |
|---|---|
| Keep `name` as the primary key | The confusion is permanent and paid by every user and every imported sheet, forever. Phase 2 explicitly sanctions diverging from Frappe vocabulary where it does not serve this platform's users. |
| Domain-prefixed standard columns (`employee_id`) | Cannot be generated without interpolating the table name; breaks on rename; stutters at call sites; defeats generic list/form code. |
| Keep `name` as key, add a separate `title` column | Leaves the reserved word `name` meaning identity — the exact source of the confusion — and adds a third identity-ish column rather than removing one. |
| Rename the key to `pk` or `row_id` | Accurate but not the vocabulary users arrive with. "ID" is the word in every source system and every spreadsheet. |
| Silent fallback for blank imported ids | Produces mixed id vocabularies in one table, invisibly. Failing loudly at the Check step is strictly better. |
