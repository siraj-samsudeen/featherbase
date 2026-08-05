# 0008 — Import inference thresholds are named, exported bets

**Status:** accepted · 2026-08-03
**Context:** the requirements framework (`docs/design/requirements-framework.md`,
Part I §4) — judgement-shaped rules have no oracle; their thresholds are
bets, not facts. A bet buried as a literal can be tuned silently and nobody
learns what the tuning cost. This ADR is the single home for every such
number in the import feature; **spec, tests, and code reference the names,
never the values.**

## The constants

Exported from `packages/shared/src/import.ts`:

| Name | Value | The bet it encodes |
|---|---|---|
| `COLUMN_NAME_MAX` | 63 | Postgres identifier headroom for generated column names |
| `INT_SAFE_DIGITS` | 15 | 10¹⁵ < 2⁵³ — Int inference can never lose precision. (Longer digit strings must not fall through to Float: #112) |
| `LONG_TEXT_CHARS` | 140 | beyond this a cell reads as prose, not a field |
| `CHOICE_MIN_SAMPLE` | 6 | fewer values and repetition proves nothing |
| `CHOICE_MIN_OPTIONS` / `CHOICE_MAX_OPTIONS` | 2 / 8 | one option is a constant; nine stop being a helpful list |
| `CHOICE_MIN_DENSITY` | 3 | each option seen ~3× on average before repetition reads as a category |
| `CHOICE_MAX_OPTION_CHARS` | 60 | longer values are content, not categories |
| `AUTO_MATCH_MIN_SCORE` | 0.6 | share of the sheet's headers that must map before auto-selecting a Table |
| `AUTO_MATCH_MIN_COVERAGE` | 0.8 | share of the Table's columns the sheet must cover (or the names must agree) |

Named locally where they are consumed:

| Name | Value | Lives in |
|---|---|---|
| `IMPORT_CHUNK` | 500 | `ImportWizard.tsx` — rows per `:import` call; the Import Log holds one row per part (`part`/`parts`), proven by IMP-I2 |
| `SUGGEST_MIN_SCORE` / `SUGGEST_MAX` | 0.3 / 3 | `ImportWizard.tsx` — weakest near-match worth surfacing, and how many |
| `ERRORS_ON_SCREEN` | 5 | `ImportWizard.tsx` — failures listed inline (Q3 owns "where does the rest go") |
| `MAX_ROWS` | 10 000 | `collection-import.ts` — per-request cap |
| `LOG_ERROR_SAMPLE` | 20 | `collection-import.ts` — failures kept in the log's error summary (Q3) |

## Rules

1. **Change = re-score.** Altering any judgement threshold (`CHOICE_*`,
   `AUTO_MATCH_*`, `SUGGEST_*`) requires re-running the labelled corpus and
   reporting the delta — never a one-reviewer verdict. Until the corpus
   exists (a recorded debt: it will be synthetic, its edge cases imagined),
   the minimum is re-running the R2/R3 example tables and saying so in the
   PR.
2. **No new literals.** A new inference threshold lands here, named, in the
   same change that introduces it.
3. **The fixture guards the interactions.** zones.csv is built so that
   `CHOICE_*` and the R2 ordering interact observably (Region promotes,
   Is Active must not) — if a tuning flips either, the example tables fail.

## Consequences

- The property tests (`import-properties.test.ts`) and the spec's example
  tables can reference boundaries by name (e.g. `INT_SAFE_DIGITS`), so a
  tuned threshold retunes its tests' generators instead of silently
  invalidating them.
- `#112`'s fix has a natural home: digit strings longer than
  `INT_SAFE_DIGITS` should infer Data, not fall through to Float.
