# Capability 3 — Auto-generated UI: Plan

> Issue: [#8](https://github.com/siraj-samsudeen/featherbase/issues/8) · Depends on: [2_spec.md](2_spec.md)
> Each step ends at a **gate**. If a gate fails, fix within the step; if the fix contradicts the
> spec, update the spec first. Commits: one per step, `feat(auto-ui): …\n\nRefs #8.`

## New dependencies

`@tanstack/react-table ^8.21.3` (apps/web, runtime). Verified against the registry in research;
adjust only if install fails and record why here.

## Step 1 — Routes + shell + DoctypeGate + DocType list

- Root layout: nav with links to `/` and `/doctypes`.
- Route files `src/routes/doctypes/…` (index, new, `$doctype/index`, `$doctype/new`,
  `$doctype/$id`) wired to components; `npm run build` regenerates `src/routeTree.gen.ts`
  (committed).
- `DoctypeGate` (definition query, loading + unknown branches, render prop).
- `DoctypeList` (empty state, entries linking to grids, New DocType link).

**G1:** `npm run build` clean (routeTree regenerated); `tsc --noEmit`; capability 1+2 tests
still green.

## Step 2 — DocType designer

`DoctypeDesigner`: name/label inputs, dynamic field-row state, options input gated on select
type, definition assembly (omit empties per spec), `doctypes.create`, navigate on success, error
display on rejection.

**G2:** `tsc --noEmit`; `eslint .` clean.

## Step 3 — Grid

`RecordGrid` inside the gate: TanStack Table v8 (`manualSorting`, columns from metadata,
`flexRender`), sortable headers only for filterable fields, filter bar with type-adapted value
control, cell formatting (Yes/No, blank for unset), row click → detail, New button, empty state,
records-pending guard.

**G3:** `tsc --noEmit`; `eslint .` clean.

## Step 4 — Record form + detail

`RecordForm` (shared create/edit: control per type, required attrs, initial values, omit-unset
collection, error display) wired into `$doctype/new` (create → navigate) and `RecordDetail`
(system fields, prefilled form → update, Delete → remove; not-found + record-pending states).

**G4:** `tsc --noEmit`; `eslint .` clean.

## Step 5 — Test matrix

`src/test.fixtures.ts` (book definition, `renderApp(path, client)` router helper, chunked
seeding for G15; coverage-excluded). Test files: `DoctypeList.test.tsx` (S1, L1–L4),
`DoctypeDesigner.test.tsx` (N1–N6), `RecordGrid.test.tsx` (G1–G15), `RecordForm.test.tsx`
(F1–F5), `RecordDetail.test.tsx` (D1–D6), `src/zero-code.test.tsx` (T1). Split is
organizational; the binding rule is **38 tests for 38 rows**, verb-first names.

**G5:** `npx vitest run` — 38 new tests + capability 1–2 suite green; count verified against the
matrix; G15 runtime sane.

## Step 6 — Coverage floor

Add `src/test.fixtures.ts` to coverage excludes.

**G6:** `npm run test:coverage` passes the 100% line threshold. Negative check: add an
unreachable branch to `RecordGrid.tsx`, confirm failure, remove.

## Step 7 — Close-out

CHANGELOG `[Unreleased]`; README status line; tick issue #8 checkboxes; comment linking the PR.

**G7 (capability done):** full local gate battery green — `npm run lint`, `npm run
format:check`, `npm run typecheck`, `npm run test:coverage`, `npm run build`, both codegen drift
checks — then push and confirm CI green.

## Rollback / risk notes

- **TanStack Table v8 + React 19 friction** (peer or types): fallback is rendering the same
  column model by hand (the component API is ours either way); record as deviation.
- **Router memory-history tests flaky across renders**: capability 1's `index.test.tsx` proves
  the pattern; keep one router per test, never share.
- **G15 too slow in jsdom**: reduce columns rendered before reducing row count — 200 is the
  guard's point.
- **jsdom constraint validation** silently letting required-empty submits through to the server:
  fine — the server rejects and the form shows the message (F5 path); the matrix asserts the
  attribute, not browser behavior.

## Deviations discovered during implementation

(recorded as they happen)
