# STC traceability — one ID across spec, test and code

Spec, Test and Code form a triangle. Each vertex makes claims about the same
behaviour, and **they drift apart continuously** — whichever was written first,
and however carefully the code was generated from the spec. Agreement at one
moment is not a property that persists.

This convention makes the triangle's **edges greppable**, so the drift is
detectable by a script instead of by someone happening to notice. It is
`code-review-8-axes` Axis 4 — *every cross-file contract needs exactly one
unique greppable token* — promoted from within-code to across-artifact.

Ported from the data-warehouse repo's `docs/agents/stc-traceability.md` (#3691)
with this repo's paths, file types and existing checkers.

---

## This repo already had half of it

Read this before concluding anything is missing. `docs/specs` obligations carry
IDs (`DEL-R3`, `IMP-J1`, `GRD-R2`), and those IDs are already cited in code
comments and test titles by hand. Measured 2026-09-18:

| | count |
|---|---|
| obligation IDs declared in `docs/specs` headings | 87 |
| distinct IDs cited in a test title | 54 |
| distinct IDs cited in `apps/*/src` or `packages/*/src` | 39 |

So the *convention* exists. What did not exist is a script that computes the
matrix and fails when a vertex is left behind, and `check-evidence.mjs` does not
close that gap: it joins the spec to **test titles** and never looks at the code.
The spec↔code edge was unchecked.

Two checkers now, one per spec home, with no overlap:

| checker | spec home | join key | in CI |
|---|---|---|---|
| `tools/check-evidence.mjs` | `docs/specs/*.md` | `> evidence:` verdict ↔ test **title**, plus runtime execution from the Vitest/Playwright JSON | yes — two jobs |
| `tools/stc-matrix.mjs` | `openspec/specs/**/spec.md` | requirement **heading** ↔ `@spec` marker in code and tests | **no — `pnpm check:stc`, run by hand** |

**That second "no" is deliberate and is the honest state of the guard.** The
OpenSpec root holds one migrated capability as a worked example; wiring a
checker into CI to police a single evaluation spec would be ceremony. When the
evaluation concludes in OpenSpec's favour, the CI step is one block in
`.github/workflows/test.yml` next to the evidence one. Until then, treat the
matrix as a review aid and **do not describe it as enforced** — an unenforced
guard that reads as enforced is worse than no guard, because it makes the next
reader stop looking (`code-review-8-axes` Axis 8).

---

## The ID

**A slug. snake_case. Two to four words. Globally unique across the repo.**

```
schema_reference_blocks
stale_pointer_gets_tombstone
id_series_survive_deletion
```

### Why a slug and not a number

Two readers, two needs, and they point the same way:

- **An agent needs to guess it.** From the requirement title *"Schema references
  block, and say who"* the ID `schema_reference_blocks` is derivable. `DEL-R3` is
  not — citing it costs a file read, every time, forever.
- **A human needs to read it in prose.** You see `stale_pointer_gets_tombstone`
  in a PR comment and know what is being discussed. `DEL-R9` tells you nothing.

The counter-argument this repo has to weigh honestly: `DEL-R3` is **shorter**,
and 87 of them are already in circulation across code, tests, commits and issue
threads. That is why the migrated spec records `Legacy ID: DEL-R3` on every
requirement rather than dropping it — see
`docs/design/openspec-vs-journey-spec.md`, which is where the two ID schemes are
compared rather than ranked here.

### Why snake_case specifically

Markdown wants kebab-case; a slug that appears in an identifier cannot contain
hyphens. Allow both and you get `stale-pointer-gets-tombstone` in the spec and
`stale_pointer_gets_tombstone` in the test — **two spellings, two greps**, which
defeats the entire point. snake_case is legal in Markdown, in TypeScript, in
comments, in SQL and in YAML. **One spelling, one grep, no translation table.**

### Naming bar

- **Two to four words.** The requirement *title* carries the full sentence; the
  ID is the handle. Long IDs get abbreviated by people, and abbreviations break
  greps.
- **Name the behaviour, not the function.** `stale_pointer_gets_tombstone`, not
  `resolve_table_name_miss`. Rename the function and the ID must survive.

### Qualification is optional

The bare slug is the reference. `stc-matrix.mjs` enforces global uniqueness
across spec files, so a bare slug is always unambiguous — which is what makes it
readable in chat and in PR comments.

A scenario is qualified as `requirement.scenario`
(`schema_reference_blocks.zero_rows_still_blocks`) and counts for its parent
requirement. Cite the narrower slug when a test proves exactly one scenario;
cite the requirement when it proves the rule.

---

## The three vertices

### 1. The spec — the heading is the ID

```markdown
### Requirement: schema_reference_blocks
Legacy ID: DEL-R3 · `shape: rule`
Status: governed (#118)
If any *other* Table's schema targets this one … SHALL be refused …

#### Scenario: zero_rows_still_blocks
- **WHEN** `Bookings.zone` references `Zones` and `Bookings` holds no rows
- **THEN** deleting `Zones` is refused and the message names `Bookings.zone`.
```

`Status: governed | characterized` is not decoration. It decides who wins when
code disagrees — see `spec-review-5-axes` Axis 2.

### 2. The code — a marker at the line that DECIDES

```ts
// @spec schema_reference_blocks
const blockers = await sql<{ parent: string; column_name: string }[]>`
  select parent, column_name from column_def
  where (reference_table = ${meta.name} or row_table = ${meta.name})
    and parent <> ${meta.name}`
```

**At the deciding line, not at the caller.** A marker on the route handler that
merely *calls* `deleteTable` is a citation that does not cover its claim — the
exact failure that let a wrong requirement survive review in the origin repo
(#3667 there). If the behaviour is decided inside a SQL string, the marker goes
on the line above that string.

**Some requirements have no single deciding line**, and that is not a defect to
paper over. A journey is a composition; an invariant is a post-condition of a
whole function. Those sit in `tools/stc-baseline.txt` as accepted `no_code` gaps
with the reason written above them, rather than getting a marker placed
arbitrarily to make the matrix look full.

### 3. The test — a marker beside the test that checks it

```ts
// @spec schema_reference_blocks.zero_rows_still_blocks
test('DEL-R3: a Reference column blocks — even with zero rows — naming Table.column', async ({ admin }) => {
```

The marker goes on the test, not on the `describe`. A suite title proves
nothing: `check-evidence.mjs` learned that the hard way (see its header, "the
same lie wears a fourth dress").

A file is treated as a TEST by **path**, not by which directory list it came
from: anything under `apps/server/test`, `apps/web/test`, `apps/web/e2e`,
`packages/shared/test`, plus any `*.test.*` / `*.spec.*` file anywhere. Without
that, a checker's own test in `tools/` would count as the *code* vertex and a
requirement would read "has code" on the strength of a test file.

---

## Running it

```bash
pnpm check:stc                       # the matrix, the mutation tests, the verdict
node tools/stc-matrix.mjs --write-baseline
```

```
requirement                     S  C  T   scenarios
------------------------------------------------------
schema_reference_blocks         Y  Y  Y   4
stale_pointer_gets_tombstone    Y  Y  Y   3
…
14 requirement(s): 10 with code, 14 with a test.
```

**Orphans fail (exit 1).** A marker naming no requirement means a slug was
renamed or deleted and a vertex was left behind — exactly the drift this exists
to catch.

**Coverage gaps ratchet (exit 2).** A NEW gap beyond `tools/stc-baseline.txt`
fails; the gaps already recorded there do not. Same shape as the vitest coverage
thresholds (#226): only ever tightens. `#` comments in the baseline carry the
*why* and are not read as gaps.

---

## What this does NOT check

**That the three vertices agree.** A requirement with a code marker and a test
marker is *linked*, not *proven*. The marker says "this line is about that
promise"; it never says "that promise holds".

This is worth stating twice, because a green matrix is exactly the kind of thing
a reader mistakes for a verdict. `openspec validate --specs --strict` has the
same property in a sharper form: it reported **1 passed, 0 failed** on the
migrated spec before a single requirement had been read against the code.
Well-formed is not true.

Agreement is a human review — `spec-review-5-axes`, `code-review-8-axes`,
`test-review-3-axes` — and when the artifacts disagree the output is the
**divergence triage item** defined in `spec-review-5-axes`: never silently pick a
winner, never punt.
