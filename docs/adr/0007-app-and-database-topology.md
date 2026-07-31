# ADR 0007: App and database topology — one control DB, foreign data bound per DocType

- **Status:** Proposed (2026-07-26)
- **Context docs:** `docs/research/frappe-multi-app-and-multi-db.md`
- **Specs that implement this:** `docs/specs/0001-external-data-sources.md`,
  `docs/specs/0002-virtual-doctypes.md`

## Context

Featherbase already runs many apps in one instance the way Frappe does: an app
is a manifest (`apps/server/src/apps.ts`) that owns DocTypes and hooks, and
every installed app shares one Postgres database, one schema, and one flat
`tab_*` namespace. That much is settled and matches the original.

Two questions are not settled:

1. **Can different apps use different databases?** Today every query in the
   process goes through the single `sql` pool in `apps/server/src/db.ts`, built
   from `config.databaseUrl`.
2. **Can an app be put on top of a database Featherbase did not create?** The
   motivating case: a control schema on a managed remote Postgres (Railway),
   already carrying real data, written continuously by CLIs that are not going
   away. The ask is a management Desk over that schema, ideally with no
   schema change at all.

Frappe answers (1) with "only per site" and (2) with "Virtual DocTypes or
migrate the data in" — see the research note. Featherbase does not have to copy
either limitation verbatim, but it does have to protect two invariants:

- **Invariant 2** — every mutation runs the full hook chain in *one transaction*.
  A transaction cannot span two Postgres servers without 2PC.
- **Referential integrity** — `Link` validation, delete protection and rename
  cascades are single-database SQL today.

## Decision

**1. Apps never get their own database or their own schema.** One control
database per site holds all metadata (`tab_doctype`, `tab_docfield`,
`tab_user`, permissions, versions, comments, files, jobs) and all
Featherbase-owned document tables, for every installed app. App identity stays
metadata, exactly as in Frappe.

**2. Foreign data is reached per *DocType*, not per app.** A `Data Source`
registry holds connections; an individual DocType may be *bound* to
`{data_source, schema, table}` with a per-field column mapping. One app can
therefore mix local and remote DocTypes, and two apps can share one remote
source — a finer and more useful granularity than "app X lives on DB Y".

**3. Featherbase never issues DDL against a foreign source.** Bound tables are
introspected, never created, altered or dropped. Migrations, `createDocType`
DDL, and the RLS policy generator all skip bound DocTypes.

**4. A bound DocType is usable with no change to the foreign schema**, provided
the table has a stable single-column primary key. Featherbase's standard columns
are *mapped when a matching column exists and synthesised when it does not*.
Features that genuinely need a column (owner-scoped permissions, optimistic
locking) degrade explicitly and are opt-in, not silently broken.

**5. Cross-source atomicity is not offered.** A save touching both the control
DB and a foreign source is two transactions, ordered foreign-last, with the
failure mode documented at the API. We do not implement 2PC.

**6. Non-Postgres sources go through a Virtual DocType controller protocol**,
mirroring Frappe's, so there is one well-trodden escape hatch instead of a
family of ad-hoc integrations.

## Alternatives considered

**Per-app database routing (`app → connection`).** Rejected. It sounds like the
natural reading of "can one app use a remote PG", but it breaks both invariants
at once: a hook chain spanning two apps could not be one transaction, and
`Link` fields between apps would need cross-database validation on every save.
It also solves the wrong problem — the motivating case is *one schema of foreign
data*, not *one app's worth of Featherbase tables living elsewhere*.

**`postgres_fdw` / foreign tables in the control DB.** Attractive because the
existing query builder would work unmodified. Rejected as the *primary*
mechanism: it needs superuser/extension rights on the control database, moves
credentials into the database, makes network failures look like local query
failures, and pushes down predicates unpredictably. It stays available as a
later per-source optimisation, invisible to the spec.

**ETL the control schema into local tables.** Rejected outright: the CLIs keep
writing, so any copy is stale by construction and a management app over stale
data is misleading.

**Copy Frappe exactly — Virtual DocTypes only.** Rejected as the *only*
mechanism. For a plain Postgres table it throws away everything Featherbase
already generates (filters, sort, pagination, count) and makes the app author
reimplement them by hand, which is precisely the class of bug frappe#17282
tracks. Virtual DocTypes remain, but as the fallback for non-SQL sources.

## Consequences

- `apps/server/src/db.ts` grows a resolver: "give me the client for this
  DocType", defaulting to the control pool. Every call site that hardcodes the
  `sql` import for *document data* (`document.ts`, `query.ts`) must route
  through it; metadata call sites stay on the control pool deliberately.
- `tableName()` stops being the single source of truth for where a DocType's
  rows live; it becomes the default when no binding exists.
- Postgres RLS (PERM-004) protects control-DB tables only. Bound DocTypes are
  protected by the server's permission layer alone — which is already the only
  path clients have (invariant 2), but it must be stated, because the
  `app_client` role guarantee does not extend to a foreign server.
- The test harness (`feather-testing-postgres`) rolls back one transaction on
  one connection. Tests touching a bound DocType need a second sandbox against
  the source, or a fixture source; the spec pins this down.
- Sites (`tenancy.ts`, schema-per-site) and data sources are orthogonal axes and
  must not be conflated: a site is *ours*, a source is *theirs*.
