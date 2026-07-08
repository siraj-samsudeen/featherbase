# Capability 2 — DocType engine: Spec

> Issue: [#6](https://github.com/siraj-samsudeen/featherbase/issues/6) · Depends on: [1_research.md](1_research.md)
> **Done when:** every matrix row below passes (row count == test count), including the 1,000-row
> filter/sort tracer bullet (F11) and the promotion round-trip properties (L3, L4), with the 100%
> line-coverage floor and all CI gates green.

## Deliverables

1. **Definition module** `convex/doctype/definition.ts` (pure): `DocTypeDefinition`/`FieldDefinition`/`DocTypeHooks` types, `validateDefinition` (normalizes: boolean flags kept only when `true`), canonical `serializeDefinition`/`parseDefinition`.
2. **Metadata + sidecar core tables** in `schema.ts`: `doctypes` (definition + `source`, `by_name` index), `fieldIndex` (`{doctype, field, value, docId}`, indexes `by_doctype_field_value` + `by_doctype_docId`); spreads generated `doctypeTables`.
3. **Repository module** `convex/doctype/repository.ts` (the single record-access seam): create/get/update/remove/list with declarative validation, hook invocation, sidecar maintenance, native-vs-sidecar path selection, plus sidecar cleanup/rebuild helpers. One contained cast to `GenericDatabaseWriter<AnyDataModel>`.
4. **Codegen**: pure `convex/doctype/codegen.ts` (`generateDoctypesModule`, `generateHookStub`, `generateHooksModule`) + `scripts/codegen-doctypes.ts` (tsx wrapper) reading `apps/web/doctypes/`; generated `convex/doctypes.gen.ts` + `convex/hooks.gen.ts` committed and drift-checked in CI; `npm run gen:doctypes` script.
5. **Sample app package** `apps/web/doctypes/`: `invoice.json` (covers all four field types) + `materializations.json` — entries are `"field"` (enabled native index) or `{"field": "...", "staged": true}` (emitted as a Convex staged index per the ADR 0004 amendment: backfills without blocking the deploy, **excluded from `nativeIndexes`** so the repository keeps serving it from the sidecar until a follow-up regen/deploy drops the flag). Sample: `{"customer": ["email", {"field": "company", "staged": true}]}`. Hand-completed hook `convex/hooks/invoice.ts` (validate: `amount > 0`; beforeSave: trim `customer`).
6. **Public functions**: `convex/doctypes.ts` (`create`, `list`, `get`, `sync`, `promote`, `demote`, `materialize`, `rebuildSidecar`) and `convex/records.ts` (`create`, `get`, `update`, `remove`, `list`) — all require auth (`requireUser` helper, throws).
7. **Test suite** implementing the matrix (54 rows), `fast-check` for L3/L4.
8. CI: `gen:doctypes` drift check step; CHANGELOG + README status updates; CLAUDE.md gains the `gen:doctypes` command.

## Definition format (canonical JSON)

```json
{
  "name": "invoice",
  "label": "Invoice",
  "fields": [
    {
      "name": "customer",
      "label": "Customer",
      "type": "text",
      "required": true,
      "filterable": true
    },
    {
      "name": "amount",
      "type": "number",
      "required": true,
      "filterable": true
    },
    {
      "name": "status",
      "type": "select",
      "filterable": true,
      "options": ["draft", "paid"]
    },
    { "name": "archived", "type": "boolean", "filterable": true },
    { "name": "notes", "type": "text" }
  ]
}
```

**Validation rules** (`validateDefinition`, throws on first violation):

- definition is a plain object; `name` matches `^[a-z][a-z0-9_]*$`; `label` (optional) is a string
- `fields` is a non-empty array; field names match the same pattern, are unique, and are not
  reserved (`name`, `owner`, `creation`, `modified`, `docstatus`)
- `type` ∈ {`text`, `number`, `boolean`, `select`}; `options` (non-empty string array) required
  for `select` and forbidden otherwise; `required`/`filterable` are booleans when present
- normalization: `required`/`filterable` kept only when `true`; unknown keys rejected

**Canonical serialization**: fixed key order (`name`, `label`, `fields`; per field `name`,
`label`, `type`, `required`, `filterable`, `options`), 2-space indent, trailing newline. Round
trip `serialize ∘ parse ∘ serialize = serialize` byte-identical (row L3).

## Storage

- **`doctypes`** row: `{ name, label?, fields, source: "package" | "site" }`, index `by_name`.
- **Records** live in `dt_<name>` (auto-created for site DocTypes; generated `defineTable` for
  package DocTypes; `defineTable(v.any())` + indexes for materialized site DocTypes). System
  fields on every record: `owner` (identity subject), `creation`, `modified` (epoch ms),
  `docstatus` (always 0 for now). User fields flat.
- **`fieldIndex`** sidecar row per (record × filterable-non-native field with a value):
  `{ doctype, field, value: string | number | boolean, docId }`. No row for unset fields.

## Behavior

**`doctypes.create({definition})`** — validates + normalizes, rejects duplicate names, stores with
`source: "site"`. **`doctypes.list()` / `doctypes.get({name})`** — return stored definitions
(`get` → `null` when unknown). **`doctypes.sync()`** — upserts every generated package definition
with `source: "package"`; idempotent (deploy-time sync per ADR 0003).

**`doctypes.promote({name})`** — requires an existing DocType; sets `source` to `"package"` and
returns the canonical JSON string (the file content the caller writes to `doctypes/<name>.json`).
Idempotent — re-promoting an already-package DocType just re-emits the file content (useful as
re-export). **`doctypes.demote({name})`** — the exact reverse (sets `source: "site"`), equally
idempotent. Neither touches a single record row.

**`doctypes.materialize({name})`** — rejects unless the DocType exists **and** appears in the
deployed `nativeIndexes` registry (models "deploy first", ADR 0004); deletes sidecar rows for the
natively-indexed fields. **`doctypes.rebuildSidecar({name})`** — re-derives sidecar rows from the
record table for every filterable field not natively indexed (the reverse rung after a
de-materializing deploy).

**`records.create({doctype, data})`** — validates data against the definition (unknown field /
missing required / wrong type / bad select option all reject), runs `beforeSave` then `validate`
hooks (package source only, keyed by DocType name), inserts with system fields, writes sidecar
rows. **`records.get({doctype, id})`** — `null` for ids that don't belong to that DocType's table.
**`records.update({doctype, id, data})`** — patch semantics: merge into existing user fields,
re-validate the merged record, re-run hooks, bump `modified`, resync sidecar rows.
**`records.remove({doctype, id})`** — deletes record + its sidecar rows.
**`records.list({doctype, filter?, sort?})`** — `filter: {field, value}` equality, `sort: {field,
direction}`; each field must be natively indexed (native path) or `filterable` (sidecar path),
otherwise reject; filter+sort together = indexed filter, then in-memory sort.

All functions throw `"Not authenticated"` for unauthenticated callers.

## Test matrix

One test per row, verb-first names. Env: all rows backend / edge-runtime integration against the
real in-memory backend except where noted. (D16 and R11 were added before implementation when
coverage planning exposed reject branches the original 51 rows never exercised — the floor doing
its job early. Promote/demote were re-spec'd idempotent at the same time: a source-state guard
would add an unreachable-in-practice branch for no behavioral gain, and idempotent promote
doubles as re-export.) Fixture DocTypes: `product` (site, sidecar:
`title` text req+filterable, `price` number filterable, `active` boolean, `category` select
[gadget, tool] filterable, `notes` text), `customer` (site, in `materializations.json`:
`email` text req+filterable with an **enabled** native index, `company` text filterable with a
**staged** native index — still sidecar-served), `invoice` (package: see JSON above).

### D — definition management

| #   | State                                 | Verify                                                            |
| --- | ------------------------------------- | ----------------------------------------------------------------- |
| D1  | create stores a site doctype          | create product → `get` returns normalized definition, source site |
| D2  | list returns created doctypes         | create two → both in `list`                                       |
| D3  | get returns null for unknown name     | `get({name:"ghost"})` → null                                      |
| D4  | rejects duplicate doctype name        | create product twice → second rejects                             |
| D5  | rejects malformed doctype name        | `"Bad Name"` → rejects                                            |
| D6  | rejects definition without fields     | `fields: []` → rejects                                            |
| D7  | rejects duplicate field names         | two fields `title` → rejects                                      |
| D8  | rejects reserved field name           | field `owner` → rejects                                           |
| D9  | rejects malformed field name          | field `"First Name"` → rejects                                    |
| D10 | rejects unknown field type            | type `date` → rejects                                             |
| D11 | rejects select field without options  | select, no options → rejects                                      |
| D12 | rejects options on a non-select field | text + options → rejects                                          |
| D13 | rejects a non-object definition       | `"nope"` → rejects                                                |
| D14 | rejects wrong-typed field property    | `required: "yes"` → rejects                                       |
| D15 | sync upserts package definitions once | run `sync` twice → exactly one invoice row, source package        |
| D16 | rejects unknown definition key        | `{..., extra: 1}` → rejects                                       |

### U — auth guard

| #   | State                                  | Verify                                           |
| --- | -------------------------------------- | ------------------------------------------------ |
| U1  | doctype create rejects unauthenticated | `testClient.mutation(doctypes.create)` → rejects |
| U2  | record list rejects unauthenticated    | `testClient.query(records.list)` → rejects       |

### R — record CRUD (site doctype, sidecar mode)

| #   | State                                    | Verify                                                                                     |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| R1  | create stores record with system fields  | returned id fetches doc: data flat, owner = caller, creation/modified numbers, docstatus 0 |
| R2  | get returns null for unknown id          | id from another doctype's table → null                                                     |
| R3  | update patches fields and bumps modified | change `price` → new value, other fields intact, `modified` ≥ before                       |
| R4  | remove deletes the record                | remove → `get` null                                                                        |
| R5  | rejects unknown doctype                  | create on `ghost` → rejects                                                                |
| R6  | rejects unknown field                    | `{bogus: 1}` → rejects                                                                     |
| R7  | rejects missing required field           | create without `title` → rejects                                                           |
| R8  | rejects wrong value type                 | `price: "cheap"` → rejects                                                                 |
| R9  | rejects select value outside options     | `category: "food"` → rejects                                                               |
| R10 | list returns the doctype's records only  | 3 product + 1 customer records → product list has exactly 3                                |
| R11 | update rejects unknown record id         | update with garbage id → rejects                                                           |

### F — filter/sort on user-defined fields (sidecar path)

| #   | State                                        | Verify                                                                                                                                                    |
| --- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | filters by text field value                  | filter `category = gadget` → exactly the matching records                                                                                                 |
| F2  | filters by number field value                | filter `price = 10` → matching records                                                                                                                    |
| F3  | rejects filter on unknown field              | filter `bogus` → rejects                                                                                                                                  |
| F4  | rejects filter on non-filterable field       | filter `notes` → rejects                                                                                                                                  |
| F5  | sorts ascending by number field              | sort `price asc` → values non-decreasing                                                                                                                  |
| F6  | sorts descending by number field             | sort `price desc` → values non-increasing                                                                                                                 |
| F7  | combines filter and sort                     | `category = gadget` + `price desc` → filtered subset, ordered                                                                                             |
| F8  | reflects updates in filter results           | update category gadget→tool → appears under tool, gone from gadget                                                                                        |
| F9  | removes deleted records from filter results  | remove → filter excludes it **and** its `fieldIndex` rows are gone                                                                                        |
| F10 | omits records missing the filtered field     | record without `price` → absent from `price` filter and sort results                                                                                      |
| F11 | **filters and sorts 1,000 records** ← tracer | 1,000 records seeded through the repository (chunked `testClient.run`); filter equality returns the exact expected subset; sort order verified end-to-end |

### G — package mode: codegen + native path + hooks

| #   | State                                       | Verify                                                                                                                            |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| G1  | codegen is deterministic and in sync        | `generateDoctypesModule(pkg JSONs, registry)` run twice → identical strings, equal to committed `doctypes.gen.ts` (`?raw` import) |
| G2  | creates package records through typed table | `records.create` invoice → lands in `dt_invoice` (passes generated validator), system fields present                              |
| G3  | filters package doctype via native index    | filter `status = paid` correct **and** `fieldIndex` has zero invoice rows (proves native path)                                    |
| G4  | sorts package doctype via native index      | sort `amount desc` → ordered                                                                                                      |
| G5  | validate hook rejects invalid record        | invoice `amount: -5` → rejects                                                                                                    |
| G6  | beforeSave hook normalizes data             | `customer: "  Acme  "` → stored `"Acme"`                                                                                          |

### L — materialization ladder + promotion round-trip

| #   | State                                           | Verify                                                                                                                                                                                       |
| --- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| L1  | promote flips source and moves zero data        | site product + records → promote returns canonical JSON parsing to the same definition; source package; records readable at same ids                                                         |
| L2  | demote flips source back                        | demote → source site; records + sidecar filters still intact                                                                                                                                 |
| L3  | serialization round-trips byte-identically      | **property** (fast-check): ∀ valid def `d`: `serialize(parse(serialize(d))) === serialize(d)`                                                                                                |
| L4  | promotion round-trips arbitrary definitions     | **property, sampled integration** (fixed-seed `fc.sample`, 25 defs): create → record → promote → demote → definition deep-equal, record untouched                                            |
| L5  | materialize drops sidecar rows, filters survive | customer (in registry): seed stale `email` sidecar rows directly → `materialize` → `email` rows gone (staged `company` rows survive — not native yet), `email` filter still correct (native) |
| L6  | rejects materializing without deployed indexes  | `materialize(product)` (not in registry) → rejects                                                                                                                                           |
| L7  | rebuildSidecar restores sidecar rows            | product records, sidecar rows wiped directly (simulated post-dematerialize) → `rebuildSidecar` → filters work, rows back                                                                     |
| L8  | keeps staged-index fields on the sidecar path   | customer record with `company` → `company` filter works via sidecar (rows present in `fieldIndex`) while `email` has none (native) — staged index not consulted until enabled                |

**54 rows. Row count == test count is the review invariant. (L8 added when the ADR 0004
staged-index amendment merged to main mid-capability; spec updated before code, per workflow.)**

## Coverage

Same floor (100% lines). New exclusions, all generated artifacts: `convex/doctypes.gen.ts`,
`convex/hooks.gen.ts`. `scripts/**` sits outside the coverage include set (`src/**`, `convex/**`)
— its logic lives in the covered pure generator; CI's drift check exercises the wrapper.
`convex/hooks/invoice.ts` is user-owned code and **is** covered (G5, G6).

## CI additions

After the existing convex-codegen drift step: `npm run gen:doctypes` + `git diff --exit-code`
(fails CI when `doctypes.gen.ts`/`hooks.gen.ts` drift from the JSON sources).

## Out of scope

Everything listed in research §"What we deliberately leave out" — UI, Excel import, permissions,
flows, computed columns, relations, pagination, JSON-Schema publication, docstatus lifecycle,
batched sidecar cleanup, multi-field filters, field unsetting.
