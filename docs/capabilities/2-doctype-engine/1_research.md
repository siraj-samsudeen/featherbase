# Capability 2 — DocType engine: Research

> Issue: [#6](https://github.com/siraj-samsudeen/featherbase/issues/6) · Date: 2026-07-08
> Inputs: [ROADMAP](../../ROADMAP.md) capability 2, [ADR 0002](../../adr/0002-storage-per-doctype-tables-plus-fieldindex-sidecar.md) (per-DocType tables + sidecar), [ADR 0003](../../adr/0003-definitions-as-json-two-sources.md) (JSON definitions, two sources), [ADR 0004](../../adr/0004-materialization-admin-triggered.md) (admin-triggered materialization), [frappe-architecture](../../research/frappe-architecture.md).

## What we're building

The metadata core everything later sits on: DocTypes as portable JSON definitions stored in a
`doctypes` metadata table, records in **one real Convex table per DocType** with Frappe-style
system fields, a fixed `fieldIndex` sidecar giving indexed filter/sort on arbitrary user-defined
fields, **one repository layer** through which all record access flows (invariant 2), package-mode
codegen (generated schema entries + types + hook stubs), and the materialization ladder
(runtime → materialized → package) where every rung is a metadata/codegen change with **zero data
movement** (invariant 3).

Tracer bullet: the test matrix covers CRUD + filter/sort on user-defined fields at realistic row
counts, and the promotion round-trip is property-tested.

## What was verified (spikes + registry, 2026-07-08)

### Convex runtime-table behavior under convex-test (assumption A1 — confirmed by spike)

ADR 0002 leans on Convex's "tables auto-create on first insert" for site-source DocTypes. Verified
in this repo with a throwaway test against `createConvexTest(schema, modules)`:

- `ctx.db.insert("dt_customer", {...})` succeeds for a table **not declared in `schema.ts`** —
  schema validation applies only to declared tables.
- `ctx.db.normalizeId("dt_customer", id)` returns the id for the right runtime table, and `null`
  both for an id from a different table and for a garbage string — exactly the guard
  `records.get` needs to answer "unknown id → null" without try/catch.

So the production design and the test harness agree; no fallback needed.

### Typing dynamic table access

Convex's generated `DataModel` can't type tables that exist only at runtime. `convex/server`
exports `AnyDataModel` (every table name allowed, documents `any`-shaped), but its `indexes` are
typed as system indexes only, so dynamic `withIndex("by_<field>", …)` doesn't typecheck against
it (confirmed during implementation — recorded as plan deviation 1). Instead the repository
declares its own `DynamicDataModel` satisfying `GenericDataModel`: documents as
`Record<string, Value>` (no `any`), free-form table and index names, and index fields typed as a
fixed-length tuple because `IndexRangeBuilder.eq()` only chains while the index-fields type has a
literal length. The repository does **one** contained cast from the generated `ctx.db` to
`GenericDatabaseWriter<DynamicDataModel>`. `defineSchema(..., { strictTableNameTypes: false })`
is _not_ needed since all dynamic access goes through the cast; core tables keep strict names.

### `defineTable(v.any())` with indexes

ADR 0004's risk-free materialization entry — indexes without strict validation — is a supported
Convex shape: `defineTable(v.any()).index("by_email", ["email"])`. Index field paths don't require
declared columns. Used verbatim for materialized site DocTypes in the generated schema module.

### Version snapshot (registry, 2026-07-08)

| Package    | Latest | Use                                                                                            |
| ---------- | ------ | ---------------------------------------------------------------------------------------------- |
| fast-check | 4.8.0  | property tests for the promotion round-trip (works fine in the edge-runtime vitest project)    |
| tsx        | 4.23.0 | runs the TS codegen script under both Node 22 (dev container) and Node 24 (CI) without a build |

Everything else is already pinned by capability 1.

## Decisions (options considered)

### 1. Definition format: minimal field-type set, canonical serialization

v1 field types: `text`, `number`, `boolean`, `select` (enum with `options`). Per-field flags:
`required`, `filterable` (Frappe's `in_standard_filter` — opts the field into sidecar/native
indexing, ADR 0002 §3). **Relations/link fields are deliberately excluded** — they arrive with
Excel import's relation suggestions (capability 4) and would drag in referential integrity
questions the tracer bullet doesn't need.

ADR 0003 §5 demands a byte-identical DB → file → DB round-trip. That forces a **canonical
serialization**: fixed key order (`name`, `label`, `fields`; per field `name`, `label`, `type`,
`required`, `filterable`, `options`), 2-space indent, trailing newline, and normalization on
intake (boolean flags stored only when `true`, so `required: false` and absent-`required` can't
produce two encodings of the same definition). `serializeDefinition`/`parseDefinition` are pure
functions — the property test targets them directly, and the promote/demote mutations reuse them.

**JSON-Schema publication deferred**: ADR 0003 says definitions are "validated against a published
JSON Schema". Shipping ajv into the Convex runtime is heavy and nothing consumes a published
schema until the AI loop (capability 9). A hand-rolled TS validator (`validateDefinition`) is the
implementation now; publishing the equivalent JSON Schema document is capability 9 work. Not a
supersession — the artifact format itself is unchanged.

### 2. System fields: Convex `_id` plays Frappe's `name`

ADR 0002 lists Frappe-style system fields `name, owner, creation, modified, docstatus`. Frappe's
`name` is the document's primary key; Convex already provides `_id` (plus `_creationTime`).
Storing a second, separate `name` key would create two sources of truth for identity, so the
engine stores `owner` (caller's identity subject), `creation`, `modified` (epoch ms — `Date.now()`
is deterministic inside Convex mutations), and `docstatus` (0 = draft; the submit/cancel lifecycle
is future work but the column exists from day one, as in Frappe). `name` stays a **reserved field
name** alongside the other four; user fields live flat on the record (Frappe-style real columns —
best for codegen'd typed validators), which is safe because reserved names are rejected at
definition time.

### 3. Record tables are prefixed `dt_`

`dt_<doctype>` (Frappe's `tab<DocType>`). The prefix makes collisions with core tables (`users`,
`tasks`, `doctypes`, `fieldIndex`) structurally impossible, so DocType names need no reserved-word
list — just the `^[a-z][a-z0-9_]*$` pattern shared with field names.

### 4. Repository layer: generic Convex functions + a pure core

Convex functions are deploy-time artifacts — site DocTypes created at runtime can't get their own
function set. So the public API is generic: `records.create/get/update/remove/list` and
`doctypes.*`, each taking the DocType name and delegating to a plain-TS repository module keyed on
the definition (the ADR's "one repository layer" seam, and the only code a future backend port
re-implements). Auth: **every** function (queries included) requires an authenticated caller via a
shared `requireUser` helper — capability 1's "unauthenticated list returns `[]`" leniency existed
for a UI this capability doesn't have; real permission semantics arrive with capability 5.

Filter/sort path per field, decided from metadata + the generated native-index registry:

- field in `nativeIndexes[doctype]` → `withIndex("by_<field>")` on the DocType's own table
- else field `filterable` → sidecar composite index `[doctype, field, value]` (equality filter;
  prefix `[doctype, field]` + index order for sort), then hydrate docs by id
- else → reject (never silently full-scan; the 32k scanned-documents cap makes hidden scans a
  production incident, per ADR 0002's motivation)

Sidecar rows are written only for filterable fields **not** natively indexed, and only when the
field has a value — unset optional fields have no row, so they're absent from filter and sort
results (documented behavior). Combined filter+sort filters by index then sorts the (bounded)
result in memory. Pagination/limits: out of scope until the grid UI (capability 3) defines needs.

### 5. Codegen: pure generator + thin script, one generated module

`generateDoctypesModule(packageDefinitions, materializations)` is a **pure string function**
(deterministic: stable ordering, no timestamps) living beside the repository code so tests cover
it to the 100% floor. A thin `scripts/codegen-doctypes.ts` (run via `tsx`, outside coverage scope)
reads `apps/web/doctypes/*.json` + `materializations.json` and writes:

- `convex/doctypes.gen.ts` — package DocTypes as fully-typed `defineTable` entries (system fields
  - typed user fields, `by_<field>` indexes for filterable fields); materialized site DocTypes as
    `defineTable(v.any())` + indexes (ADR 0004); `nativeIndexes` registry; parsed
    `packageDefinitions` (for site sync); generated TS types per package DocType.
- `convex/hooks/<name>.ts` — typed lifecycle stubs (`validate`, `beforeSave`), generated **only
  if absent** (they're user-owned code afterwards — the one non-idempotent output, same policy as
  Frappe controller stubs).
- `convex/hooks.gen.ts` — registry wiring hook modules to DocType names.

`schema.ts` stays hand-written for core tables and spreads `...doctypeTables` — the generated
portion is deterministic output of (package JSONs + registry), committed, drift-checked in CI
(same policy as `_generated/` and `routeTree.gen.ts`). This honors ADR 0004's "schema.ts is fully
generated" for everything DocType-shaped while keeping the four fixed core tables out of the
generator's blast radius.

Rejected: an npm workspace package (`packages/engine`) for the pure core. The Convex esbuild
bundler + vitest + tsx would each need to resolve TS-source workspace exports; nothing outside
`apps/web` consumes the engine yet. Extract when a second consumer exists (the CLI, capability 4+).

### 6. Materialization: the generated registry _is_ the path flip

ADR 0004's sequence — regenerate schema, deploy, flip repository metadata, cleanup — collapses
one step: since the repository consults the generated `nativeIndexes` at runtime, the deploy
itself flips the read/write path (writes stop maintaining sidecar rows, reads go native). The
`doctypes.materialize` mutation is then the **cleanup rung**: it verifies the DocType is actually
in the deployed registry (rejects otherwise — models "deploy first"), and deletes the now-dead
sidecar rows for the materialized fields (inline; bounded row counts now, the scheduled batch job
arrives with ADR 0004's stats-suggested phase). The reverse rung `doctypes.rebuildSidecar`
repopulates sidecar rows from the record table after a de-materializing deploy — making the rung
independently reversible as invariant 3 requires.

**Staged indexes (ADR 0004 amendment, merged to main mid-capability):** the registry-driven flip
maps 1:1 onto the amendment's two-deploy sequence. A registry entry marked
`{"field": "...", "staged": true}` is emitted as `.index(..., { staged: true })` (backfills
without blocking the deploy) and **excluded from `nativeIndexes`** — so writes keep maintaining
sidecar rows and reads keep using them, exactly the "don't flip until enabled" requirement. The
enabling step is dropping the flag and regenerating: the field enters `nativeIndexes`, the next
deploy flips the path, and `materialize` cleans up. Choosing staged automatically above a
row-count threshold needs runtime stats — ADR 0004 phase 2, not this capability.

### 7. Hooks: package-mode only, invoked by the repository

Per ADR 0003 §4, site DocTypes get declarative validation only; code hooks require package mode.
The repository invokes `hooks[doctype]?.validate` (throw to reject) and `?.beforeSave` (return
transformed user data) on create and update, after declarative validation. The sample app package
ships an `invoice` DocType whose hook implements a real rule (amount must be positive; customer
trimmed) so the hook path is honestly testable. Full Frappe lifecycle (`afterSave`, `onTrash`, …)
waits for the Flows engine (capability 6) to define the event bus.

### 8. Property testing: fast-check on the pure seam + sampled integration

"Promotion round-trip is property-tested" (ROADMAP). Two layers:

- **Pure property** (fast-check, arbitrary valid definitions): canonical serialization is a
  fixpoint — `serialize(parse(serialize(d))) === serialize(d)` byte-identical.
- **Integration property** (fixed-seed `fc.sample` over the same arbitrary, real in-memory
  backend): for each sampled definition — create as site DocType, write a record, promote (source
  flip + canonical JSON out), demote — the definition survives deep-equal and the record is
  untouched at the same id (zero data movement, invariant 3). Running full fast-check shrinking
  against the backend would be slow for no extra confidence; sampling keeps it honest and fast.

### 9. Realistic row counts

The tracer-bullet test seeds **1,000 records** through the repository seam (chunked `testClient.run`
transactions calling the repository directly — the exact code path mutations use, without paying
1,000 separate mutation round-trips), then verifies filter subsets and sort order through the
public query. 1,000 sits above any demo-toy count and safely under Convex's per-transaction write
caps even with sidecar amplification (each chunk stays < 4,096 writes).

## What we deliberately leave out

Auto-generated UI (capability 3 — this capability ships **no UI**; the existing tasks demo app is
untouched), Excel import (4), permissions beyond require-auth (5), flows/lifecycle events beyond
the two hook stubs (6), computed columns (8), published JSON Schema + ajv validation (9), relation
fields (4), record pagination, `docstatus` submit/cancel semantics, scheduled sidecar-cleanup
batching, sidecar query statistics (ADR 0004's phase 2), multi-field composite filters, unsetting
fields on update.
