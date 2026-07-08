# Capability 2 — DocType engine: Plan

> Issue: [#6](https://github.com/siraj-samsudeen/featherbase/issues/6) · Depends on: [2_spec.md](2_spec.md)
> Each step ends at a **gate**. If a gate fails, fix within the step; if the fix contradicts the
> spec, update the spec first. Commits: one per step, `feat(doctype): …\n\nRefs #6`.

## New dependencies

`fast-check ^4.8` (dev, apps/web), `tsx ^4.23` (dev, apps/web). Both verified against the
registry in research; adjust only if install fails and record why here.

## Step 0 — Spike (done during research)

Verified convex-test accepts inserts into undeclared tables and `normalizeId` guards runtime-table
ids. Recorded in research §"What was verified". No code remains.

## Step 1 — Definition module (pure)

`convex/doctype/definition.ts`: `FieldType`, `FieldDefinition`, `DocTypeDefinition`,
`DocTypeHooks` types; `RESERVED_FIELD_NAMES`; `validateDefinition(value: unknown):
DocTypeDefinition` (all spec rules, normalizes true-only flags, strips nothing silently — unknown
keys reject); `serializeDefinition` (canonical key order, 2-space indent, trailing newline);
`parseDefinition = validate ∘ JSON.parse`.

**G1:** `npx tsc --noEmit` clean. (Tests arrive with the matrix in step 6 — but writing D-row
tests early against this module is allowed and encouraged.)

## Step 2 — Sample package + codegen

- `apps/web/doctypes/invoice.json` (spec's canonical example), `apps/web/doctypes/materializations.json` = `{"customer": ["email"]}`.
- `convex/doctype/codegen.ts` (pure): `generateDoctypesModule(defs, materializations): string`
  emitting `doctypeTables` (typed `defineTable` per package DocType — system fields `owner`/
  `creation`/`modified`/`docstatus` + user-field validators, optional unless `required`; select →
  `v.union(v.literal(...))`; `by_<field>` index per filterable field; `defineTable(v.any())` +
  indexes per materialization entry), `nativeIndexes`, `packageDefinitions`, and one exported
  TS type per package DocType. `generateHookStub(def): string`, `generateHooksModule(defs): string`.
- `scripts/codegen-doctypes.ts`: read JSONs → validate via `parseDefinition` → write
  `convex/doctypes.gen.ts`, `convex/hooks.gen.ts`, and `convex/hooks/<name>.ts` **only when
  missing**. Root + workspace script `gen:doctypes` (`tsx scripts/codegen-doctypes.ts`).
- Run it; hand-complete `convex/hooks/invoice.ts` (validate: `amount > 0`; beforeSave: trim
  `customer`). Add gen files to `.prettierignore` + eslint ignores; exclude from coverage.

**G2:** `npm run gen:doctypes` twice → `git diff` clean on the second run (idempotent);
`tsc --noEmit` clean with the generated module imported nowhere yet.

## Step 3 — Schema wiring

`schema.ts`: add `doctypes` + `fieldIndex` core tables, spread `...doctypeTables` from
`doctypes.gen.ts`. Regenerate `convex/_generated` (`npx convex codegen --system-udfs --typecheck
disable`), commit.

**G3:** codegen drift-clean on re-run; `tsc --noEmit`; existing capability-1 tests still green
(`npx vitest run`).

## Step 4 — Repository module

`convex/doctype/repository.ts`: `asAnyDb` cast helper; `validateData(def, data)` (unknown/
required/type/options); `createRecord`, `getRecord` (normalizeId guard), `updateRecord` (merge →
validate → hooks → patch + `modified` bump → sidecar resync), `deleteRecord`, `listRecords`
(filter/sort path selection per spec: nativeIndexes → `withIndex(by_<field>)`; filterable →
sidecar; else throw), `clearSidecar(def)` (materialized fields only), `rebuildSidecar(def)`. Hook
invocation for package-source definitions via `hooks.gen.ts` registry (one contained
`Record<string, HookFns>` cast). Sidecar writes only for filterable, non-native, value-present
fields.

**G4:** `tsc --noEmit` clean; no `any` literals outside the two documented casts (`eslint .`).

## Step 5 — Public functions

`convex/doctype/auth.ts` (`requireUser` — throws "Not authenticated", returns subject);
`convex/doctypes.ts` (create/list/get/sync/promote/demote/materialize/rebuildSidecar);
`convex/records.ts` (create/get/update/remove/list). Args: `definition`/`data` as `v.any()`
validated in-handler; everything else precisely typed. Regenerate `_generated`.

**G5:** `tsc --noEmit`; `npx vitest run` still green (existing suite).

## Step 6 — Test matrix

`convex/doctype/definition.test.ts` (D5–D14 via the pure validator where natural, L3 property),
`convex/doctypes.test.ts` (D1–D4, D15, U1, L1, L2, L5–L7), `convex/records.test.ts` (R rows, U2),
`convex/records.filter.test.ts` (F rows incl. F11), `convex/packageMode.test.ts` (G rows, L4).
Split is organizational; the binding rule is **51 tests for 51 rows**, verb-first names.
Shared `arbDefinition` fast-check arbitrary (normalized-form definitions) in a test helper.

**G6:** `npx vitest run` — 51 new tests + 12 capability-1 tests green; count verified against the
matrix; F11 runtime sane (< ~15 s).

## Step 7 — Coverage floor

Add `convex/doctypes.gen.ts` + `convex/hooks.gen.ts` to coverage excludes.

**G7:** `npx vitest run --coverage` passes the 100% line threshold. Negative check: add an
unreachable branch to `repository.ts`, confirm failure, remove.

## Step 8 — CI + docs close-out

- `.github/workflows/ci.yml`: add `npm run gen:doctypes && git diff --exit-code` after the convex
  codegen drift step.
- CHANGELOG `[Unreleased]` entries; README status line; CLAUDE.md commands (`gen:doctypes`).
- Tick issue #6 checkboxes; comment linking the branch/PR.

**G8 (capability done):** full local gate battery green — `npm run lint`, `npm run format:check`,
`npm run typecheck`, `npm run test:coverage`, `npm run build`, both codegen drift checks — then
push and confirm CI green.

## Rollback / risk notes

- **convex-test undeclared-table support regresses** (dep bump): step-0 spike is cheap to re-run;
  fallback is declaring test-fixture tables in a test-only schema wrapper — record as deviation.
- **`withIndex` with dynamic names on `AnyDataModel`** misbehaving at runtime: G4/G6 catch it;
  fallback is `.filter()` on the sidecar query (never on record tables).
- **F11 too slow** in CI: shrink chunk size or row count only as a last resort — the row count is
  the tracer bullet; try seeding via fewer, larger `testClient.run` chunks first (write-cap math
  in research §9).
- **Write-cap arithmetic** (4,096 writes/transaction): each F11 chunk seeds ≤ 250 records × (1
  record + ≤3 sidecar rows) = ≤1,000 writes — 4× headroom.

## Deviations discovered during implementation

(recorded as they happen, per the plan's own rule)
