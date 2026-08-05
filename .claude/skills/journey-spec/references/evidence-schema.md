# Evidence CSV schema — `docs/specs/evidence/<feature>.csv`

One row per obligation. Canonical instance:
`docs/design/evidence/spreadsheet-import.csv`.

| Column | Meaning |
|---|---|
| `id` | Spec ID (`FEAT-R2`) or sub-ID minted at first citation (`FEAT-R2.7`, `FEAT-R6.follows-final-name`) |
| `shape` | rule · sequence · contract · invariant · judgement · hazard · question |
| `strategy` | Primary verification strategy actually used (properties, browser walk, api, reconciliation, corpus, decision, none) |
| `static_link` | Test files whose titles quote the ID — **static traceability, a linkage claim, never execution evidence** |
| `verdict` | See vocabulary below; free text after the keyword is encouraged |
| `issue` | GitHub issue for defects/pins (`#110`) |
| `stamped` | Date (and commit when scripted) the verdict was last verified — an unstamped row is a hypothesis |

## Verdict vocabulary

- `proven` — the strategy ran and passed at its intended tier
- `conditionally-proven` — passes with a named caveat (e.g. self-skips on
  a used DB); the caveat is part of the verdict
- `rule-tier only` — proven below the tier a user experiences
- `expected-failing pin` — an `it.fails`/`test.fail` asserting the SPEC,
  tagged with its issue; fixing the defect flips it
- `known-gap` — spec'd, violated, and **no evidence claim exists** (used
  where an expected-failing test is impractical)
- `gap` — spec'd, nothing implements or asserts it
- `reported` — a review's claim not yet re-executed here
- `open` — an undecided question or hazard awaiting its arbiter

Rules: never mark a grouped row `proven` when one clause is violated —
mint the sub-ID and split the row. A skipped test never contributes to
`proven`. Update this CSV in the same change as the tests it describes.
