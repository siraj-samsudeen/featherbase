# Capability 3 — Auto-generated UI: Research

> Issue: [#8](https://github.com/siraj-samsudeen/featherbase/issues/8) · Date: 2026-07-09
> Inputs: [ROADMAP](../../ROADMAP.md) capability 3, [ADR 0003](../../adr/0003-definitions-as-json-two-sources.md) (definitions drive everything), capability 2 (`doctypes.*` / `records.*` functions), [revalidation-2026-07](../../research/revalidation-2026-07.md) action 4 (grid re-research obligation).

## What we're building

The first user-visible payoff of the metadata core: create a DocType and get a working **grid**,
**form**, and **detail** view — all rendered from the stored definition, none of it written per
app. A DocType designer form makes the loop closable entirely in the UI. This capability is a
**pure UI layer**: zero backend changes; every byte of data flows through capability 2's
`doctypes.*` / `records.*` functions (repository invariant preserved by construction).

Tracer bullet: build a working app with zero code — design a DocType, add a record through the
generated form, see it in the generated grid, open/edit it in the detail view, delete it.

## Grid re-research (the obligation from issue #4)

Verified against the live npm registry on 2026-07-09:

| Candidate                         | Latest                        | Published  | Verdict                                                                                                                                                                                                                                         |
| --------------------------------- | ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@glideapps/glide-data-grid`      | 6.0.3                         | 2024-02-03 | **Dead** — ~2.5 years without a release, confirming the revalidation finding. Canvas-rendered, so it was also untestable in jsdom.                                                                                                              |
| `glide-data-grid-fork`            | 6.0.4-alpha9                  | 2026-01-03 | Only visible fork: alpha-tagged, single-maintainer, no community. Not a foundation.                                                                                                                                                             |
| `ag-grid-community` / `-react`    | 36.0.0                        | 2026-06-24 | Alive and MIT at the core, but heavy (hundreds of kB), DOM-virtualized (rows outside the viewport don't exist in jsdom — breaks integration testing), config-driven theming, enterprise upsell surface.                                         |
| `react-data-grid`                 | 7.0.0-beta.59                 | 2025-12-04 | Perpetual beta (7.0.0-beta since 2021).                                                                                                                                                                                                         |
| `@inovua/reactdatagrid-community` | 5.10.2                        | 2023-07-31 | Dead.                                                                                                                                                                                                                                           |
| `@tanstack/react-table`           | 8.21.3 (9.0.0-beta.36 active) | 2025-04-14 | **Chosen.** v8 stable, MIT, headless — renders real DOM we control, so feather-testing-convex jsdom integration tests work unmodified. v9 beta is publishing near-daily (beta.36 on 2026-07-07): don't chase the beta, same policy as Vitest 5. |
| `@tanstack/react-virtual`         | 3.14.5                        | 2026-06-30 | Alive; **deferred** — see below.                                                                                                                                                                                                                |

**Verdict: TanStack Table v8, headless, no virtualization yet.**

- **Headless beats canvas/virtualized here** because the binding testing conventions (real
  in-memory backend, jsdom, 100% line floor) require the grid to be real DOM. Glide (canvas) and
  AG Grid (viewport-only row rendering) both make the integration tests dishonest or impossible.
- **It earns its keep over a hand-rolled `<table>`** by owning the column model (accessors built
  from field metadata), header/cell rendering (`flexRender`), and sorting state — and it's the
  standard substrate for what later capabilities add (selection, inline editing for computed
  columns, resizing) without a rewrite. It's ~15 kB and already family: Router and Query are
  TanStack.
- **Server-side filter/sort maps onto `manualSorting`**: the table owns the sorting UI state; the
  data work stays in the repository layer (sidecar/native path, ADR 0002). The grid never sorts or
  filters client-side — the whole point of capability 2 was making the server do this indexed.
- **Virtualization deferred**: `@tanstack/react-virtual` measures element heights, which are 0 in
  jsdom (tests would render only overscan rows), and it only matters once `records.list` returns
  unbounded row counts — which it can't yet: pagination was explicitly deferred out of capability
  2 ("until the grid UI defines needs"). Verdict recorded for that future work: pagination and
  virtualization arrive **together**, as one capability, when real row counts demand them. The
  grid's realistic-count guard (200 rendered rows, matrix G15) keeps the current no-slicing
  behavior honest.

## Decisions (options considered)

### 1. Routes: one route set serves every DocType

File-based routes under `/doctypes`: index (DocType list), `new` (designer), `$doctype` (grid),
`$doctype/new` (record form), `$doctype/$id` (detail). The DocType name is a URL param — the
same five route files serve every app ever built on Featherbase; nothing is generated per
DocType. `/` keeps the capability-1 tasks demo untouched (its tracer stays green); the root
layout gains a nav link.

### 2. `DoctypeGate`: one shared guard for definition loading

Grid, record form, and detail all need the definition before rendering, and all need the same
two edge states (definition pending → loading; unknown name → message). A shared `DoctypeGate`
component owns the `doctypes.get` query and both branches via a render prop, so the states exist
**once** — one mocked loading test and one unknown-doctype test instead of three of each. This
also sequences correctly: `records.list` throws server-side for unknown DocTypes, and the gate's
null-check renders the message before any child query can wedge.

### 3. Form semantics: omit what's unset

The generated form maps field types to controls (text → text input, number → number input,
boolean → checkbox, select → `<select>` with the definition's options plus an empty choice).
Empty inputs are **omitted** from the submitted data — this is load-bearing, not cosmetic:
capability 2 defined "unset field ⇒ no sidecar row ⇒ absent from filter/sort", so a form that
submitted `""` for untouched fields would corrupt filter results. Two documented consequences:

- **An unchecked checkbox means unset, not `false`.** A checkbox can't express the
  set-false/unset distinction; explicit `false` becomes storable when a tri-state control ships
  (with computed columns or when a real need appears).
- **Editing can't unset a field.** `records.update` has patch semantics and field-unsetting was
  explicitly out of capability 2's scope; clearing an input just leaves the stored value alone.
  Both wait for the backend to grow unset support — UI-only workarounds would lie.

`required` renders the HTML attribute; jsdom doesn't reliably enforce constraint validation on
submit, so the honest test asserts the attribute and the server remains the backstop (its
rejection surfaces through the form's error display, which has its own matrix row).

### 4. Designer scope: create-only

The designer builds a definition (name, label, dynamic field rows with type/required/filterable/
options) and calls `doctypes.create` — validation stays server-side (`validateDefinition` is the
single source of truth; the designer just surfaces the thrown message). Empty optional inputs
(label, flags left unchecked) are omitted so the stored definition is already in normalized form.
**Editing an existing DocType is out of scope**: schema evolution against live records (type
changes, field removal vs. sidecar rows) is real design work that belongs with Excel import's
schema inference (capability 4) — a create-only designer already closes the zero-code loop.

### 5. Filter UI: one field + one value, typed per field

The grid's filter bar is a filterable-field select plus a value control that adapts to the field
type (number input parsed to number, Yes/No select parsed to boolean, the definition's options
for select fields, text input otherwise). Exactly mirrors the `records.list` filter contract —
single-field equality. Multi-field filters were out of capability 2's backend scope, so the UI
doesn't pretend otherwise. Sorting: clicking a filterable column header toggles asc/desc through
TanStack's sorting state, passed straight to `records.list`'s `sort` arg. Non-filterable columns
render inert headers — the repository would reject them (never silently full-scan), so the UI
doesn't offer what the server won't do.

### 6. Auth stance unchanged

Every function requires an authenticated caller (capability 2); tests run through
`renderWithConvexQueryAuth` exactly like capability 1's. No sign-in UI ships here — that's
capability 5 (permissions) territory, noted on the issue. The deployed app needs auth wiring
then; nothing in this capability makes that harder.

### 7. Loading states are the only mocked rows

Per the binding conventions: the real in-memory backend resolves too fast to pin loading states
deterministically, so they're mocked (never-resolving query functions), including the partial
mock (definition resolves, records pend) that pins the grid's second guard. Everything else in
the matrix — including both error-message rows — runs against the real backend.

### 8. Realistic row count: 200 rendered rows

The backend's 1,000-row tracer (capability 2, F11) already proves indexed filter/sort at count;
the grid's job is proving the UI renders what the server returns without slicing or choking.
200 rows × 5 columns in jsdom renders in low seconds — enough to catch an accidental
`slice(0, 50)` or quadratic render, cheap enough to keep the suite fast. Seeded through the
repository seam in chunked `testClient.run` transactions, same technique as F11.

## Version snapshot (registry, 2026-07-09)

| Package                 | Pin     | Use                                                    |
| ----------------------- | ------- | ------------------------------------------------------ |
| `@tanstack/react-table` | ^8.21.3 | headless grid: column model, sorting state, flexRender |

Everything else is already pinned by capabilities 1–2.

## What we deliberately leave out

Excel import (4), sign-in UI / permissions (5), flows (6, 7), computed columns + inline grid
editing (8), relation fields (4), DocType editing/migration, pagination + virtualized scrolling
(one future capability, together), saved/named views, multi-field filters, unsetting fields from
the form, tri-state boolean control, `docstatus` surfacing (always 0 until submit/cancel
semantics exist).
