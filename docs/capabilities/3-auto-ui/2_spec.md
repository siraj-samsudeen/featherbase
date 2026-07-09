# Capability 3 — Auto-generated UI: Spec

> Issue: [#8](https://github.com/siraj-samsudeen/featherbase/issues/8) · Depends on: [1_research.md](1_research.md)
> **Done when:** every matrix row below passes (row count == test count), including the zero-code
> tracer (T1) and the 200-row grid guard (G15), with the 100% line-coverage floor and all CI
> gates green.

## Deliverables

1. **Routes** (file-based, TanStack Router): `/doctypes` (DocType list), `/doctypes/new`
   (designer), `/doctypes/$doctype` (grid), `/doctypes/$doctype/new` (record form),
   `/doctypes/$doctype/$id` (detail). Root layout gains a nav link to `/doctypes`; `/` (tasks
   demo) untouched.
2. **Components** (`src/components/`): `DoctypeList`, `DoctypeDesigner`, `DoctypeGate` (shared
   definition guard: loading + unknown-DocType states, render prop), `RecordGrid` (TanStack
   Table v8, `manualSorting`), `RecordForm` (shared by create and edit), `RecordDetail`.
3. **Dependency**: `@tanstack/react-table ^8.21.3` (apps/web).
4. **Test suite** implementing the matrix (38 rows) + shared UI fixtures (`src/test.fixtures.ts`:
   `book` definition, router-render helper, chunked seeding — coverage-excluded like
   `convex/doctype/test.helpers.ts`).
5. CHANGELOG entry; README status; issue #8 checkboxes ticked at close-out.

**No backend changes.** All data access via the existing `api.doctypes.*` / `api.records.*`.

## Behavior

**DocType list** — `doctypes.list`; empty state "No DocTypes yet"; each entry (label ?? name)
links to its grid; "New DocType" links to the designer.

**Designer** — inputs: name, label; dynamic field rows (name, label, type select, required +
filterable checkboxes, comma-separated options input rendered only when type = select); "Add
field" / per-row "Remove". Submit builds a definition **omitting** empty label, empty per-field
labels, unchecked flags, and non-select options, then `doctypes.create` → navigate to
`/doctypes/$name`. Server rejection → message shown, form state kept.

**Grid** — inside `DoctypeGate`. Columns from `definition.fields` (header = label ?? name), rows
from `records.list`. Cell rendering: `undefined` → empty, boolean → Yes/No, else string. Sorting:
filterable columns render header buttons toggling asc → desc through TanStack sorting state →
`records.list` `sort` arg; non-filterable headers are plain text. Filter bar: filterable-field
select + type-adapted value control (number input → `Number(...)`, Yes/No select → boolean,
definition options for select fields, text input otherwise); empty value = no filter; "Clear"
resets. Row click → detail. "New" → record form. Empty state "No records yet". Records pending
(definition already resolved) → loading.

**Record form** — one component for create and edit: control per field type (text input, number
input, checkbox, select with empty choice + options), `required` attribute from the definition,
initial values when editing. Submit collects **only set values** (empty string / unchecked
checkbox / empty select ⇒ key omitted; number parsed), then `records.create` or `records.update`
→ navigate to the grid. Server/hook rejection → message shown, stays on form.

**Detail** — inside `DoctypeGate`; `records.get`. `null` → "Record not found". Otherwise: system
fields (owner, created, modified) + `RecordForm` prefilled with the record's user fields (save =
update → grid) + Delete button (`records.remove` → grid). Patch semantics upstream mean clearing
an input leaves the stored value (research §3; documented, not worked around).

## Test matrix

One test per row, verb-first names. Env: jsdom (`web` vitest project) against the real in-memory
backend via `renderWithConvexQueryAuth`, each test rendering the real `routeTree` with a memory
history; **mocked rows are exactly the four loading states** (L4, G13, G14, D6 — never-resolving
or partially-resolving query fns). Fixture DocTypes: `book` (site, created per test via
`doctypes.create`: `title` text req+filterable, `pages` number filterable, `signed` boolean
filterable, `genre` select [fiction, science] filterable, `remarks` text), `invoice` (package,
via `doctypes.sync` — its validate hook rejects `amount ≤ 0`, F5).

### S — app shell

| #   | State                              | Verify                                            |
| --- | ---------------------------------- | ------------------------------------------------- |
| S1  | links from home to the DocType list | render `/` → click "DocTypes" nav → list renders |

### L — DocType list

| #   | State                                    | Verify                                             |
| --- | ---------------------------------------- | -------------------------------------------------- |
| L1  | shows empty state when no doctypes       | `/doctypes` → "No DocTypes yet"                    |
| L2  | lists doctypes with their labels         | create book + sync invoice → "Book" and "Invoice"  |
| L3  | navigates to a doctype grid when clicked | click "Book" → book grid renders                   |
| L4  | shows loading state while doctypes pend  | **mock** (never-resolving queries)                 |

### N — DocType designer

| #   | State                                        | Verify                                                                                  |
| --- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| N1  | creates a doctype and opens its empty grid   | name+label+one field, submit → grid empty state; backend `doctypes.get` returns the definition |
| N2  | adds and removes field rows                  | add two rows, remove one → one field row remains                                        |
| N3  | shows options input only for select fields   | type→select shows options input; back to text hides it                                  |
| N4  | submits required and filterable flags        | check both → stored field has `required: true`, `filterable: true`                      |
| N5  | omits empty optional inputs                  | no label, flags unchecked → stored definition/field has no `label`/`required`/`filterable` keys |
| N6  | shows server error for invalid definition    | create book first, submit designer with name `book` → "already exists" shown, still on designer |

### G — grid

| #   | State                                        | Verify                                                                              |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| G1  | shows empty state when no records            | book, no records → "No records yet"                                                 |
| G2  | renders a column per field and a row per record | headers Title/Pages/Signed/Genre/remarks; two seeded records → two data rows      |
| G3  | renders booleans as Yes/No and missing values blank | `signed: true` → "Yes"; record without `pages` → empty cell                   |
| G4  | sorts ascending when a sortable header is clicked | click Pages → cell order ascending                                             |
| G5  | toggles descending on second click           | click Pages twice → descending                                                      |
| G6  | offers sorting only on filterable fields     | `remarks` header is not a button; Pages header is                                   |
| G7  | filters by select field option               | filter genre = fiction → only matching rows                                         |
| G8  | filters by number field value                | field Pages → number input; value 100 → only matching rows                          |
| G9  | filters by boolean field value               | field Signed → Yes/No select; Yes → only signed rows                                |
| G10 | clears the filter to show all records        | apply filter, click Clear → all rows back                                           |
| G11 | navigates to detail when a row is clicked    | click row → detail view for that record                                             |
| G12 | shows message for unknown doctype            | `/doctypes/ghost` → unknown-DocType message                                         |
| G13 | shows loading state while the definition pends | **mock** (never-resolving)                                                        |
| G14 | shows loading state while records pend       | **mock** (definition resolves, records never)                                       |
| G15 | renders 200 records filtered and sorted ← realistic-count guard | 200 seeded via chunked `run`; genre filter + pages desc → correct row count and first/last cells |

### F — record form

| #   | State                                       | Verify                                                                          |
| --- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| F1  | renders an input matching each field type   | text input, number input, checkbox, select with fiction/science options         |
| F2  | marks required fields as required           | Title input `required`; Pages not                                               |
| F3  | creates a record and returns to the grid    | from grid click New, fill title+pages+signed+genre, save → grid shows the row   |
| F4  | omits unset optional fields                 | save with only title → backend record has no `pages`/`genre`/`signed`/`remarks` keys |
| F5  | shows server error and stays on the form    | invoice, `amount: -5` → hook message shown, form still rendered                 |

### D — detail

| #   | State                                     | Verify                                                              |
| --- | ----------------------------------------- | -------------------------------------------------------------------- |
| D1  | shows record values prefilled for editing | inputs contain the stored values                                    |
| D2  | shows system fields                       | owner, created, modified rendered                                   |
| D3  | saves edits and reflects them in the grid | change pages, save → grid shows new value                           |
| D4  | deletes the record and returns to the grid | Delete → grid empty state; backend `records.get` → null            |
| D5  | shows message for unknown record          | create+delete a record, visit its id → "Record not found"           |
| D6  | shows loading state while the record pends | **mock** (definition resolves, record never)                       |

### T — tracer bullet

| #   | State                              | Verify                                                                                                                                                                     |
| --- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | builds a working app with zero code | UI only, starting at `/`: nav → New DocType → design `book` (title text req+filterable, pages number filterable) → empty grid → New → fill → save → row in grid → click row → edit pages → save → grid updated → Delete → empty grid |

**38 rows. Row count == test count is the review invariant.**

## Coverage

Same floor (100% lines). New exclusion: `src/test.fixtures.ts` (test-only fixtures, same policy
as `convex/doctype/test.helpers.ts`). Route files and all components are covered.

## Out of scope

Everything in research §"What we deliberately leave out" — Excel import, sign-in UI, flows,
computed columns/inline editing, relations, DocType editing, pagination + virtualization, saved
views, multi-field filters, field unsetting, tri-state booleans, docstatus surfacing.
