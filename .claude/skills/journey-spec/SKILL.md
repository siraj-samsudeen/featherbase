---
name: journey-spec
description: >
  Author or retrofit a Featherbase feature spec in the journeys-and-rules
  form: narrative journeys with step triples, shape-tagged rules with
  example tables and properties, invariants, hazards, open questions with
  a named arbiter, and a one-line evidence verdict per obligation. Use
  when writing requirements for a new feature, recovering a spec from
  shipped behaviour, or updating spec/evidence after building. Full
  rationale: docs/design/requirements-framework.md.
---

# Journey-Spec

The featherbase-local requirements form. This file is the operating
protocol; the theory and its evidence live in
`docs/design/requirements-framework.md` (read it once; follow this file
day-to-day).

## The artifacts and their formats

One feature produces:

| Artifact | Format | Why this format |
|---|---|---|
| `docs/specs/NNNN-<feature>.md` | Markdown | Narrative + tables + the evidence verdicts — what humans sign and agents author. Never HTML. |
| Fixture files | Real files (`e2e/fixtures/*.csv` + a `.claims.md`) | The agreement dataset the tests literally load. |
| Manual | `docs/manual/<feature>.html`, **generated** (`pnpm manual:build`) | One page, three lenses (Read / Test / Build), rendered from the spec by `tools/build-manual.mjs` — never a source; edit the spec and rebuild. Screenshot slots keyed by step ID, filled by `SNAP=1` journey runs. Precedent: spec 0008. |

HTML is a presentation format, not a source format: verbose to edit,
hostile to diffs. Markdown carries the spec; HTML is always downstream.

**Evidence is not a separate artifact.** It was a CSV beside the spec
until 2026-08-28 (issue #235); a join table between specs and tests
should be derived and checked, not curated. Each obligation now carries a
one-line verdict in the spec, and `tools/check-evidence.mjs` re-derives
the linkage on every CI run.

## Authoring steps

1. **Job + fixture *or prior state*.** One sentence per job. Data-shaped
   features get a deliberately benign agreement fixture (each column
   exercising a different rule; limits stated). Features whose input is
   *residue* — state another feature leaves behind, as deletion's is —
   describe that prior state instead; reusing the upstream feature's
   fixture is the honest move (trial #1 finding).
2. **Journeys** (2–3): the walk told once, each step a quadruple
   *(where am I, what do I do, what must I observably see, and one "Bug
   if" clause — the failure this step exists to catch)* — every "see"
   an observable at a declared boundary. **Journey steps speak the
   user's language** (press-release voice; the test of a "see" is
   whether someone who has never read the code could read it off the
   screen). No implementation nouns in a journey — storage keys, chunk
   sizes, thresholds, routes all belong in the rules layer. Loops are
   repeating groups; durable failure states are named states. Each
   journey states its **isolation strategy**; a skip is never a pass.
3. **Sort the edge cases** — the triple-convergence rule: same walk,
   different values → an example-table row; the walk forks → a branch
   step; nobody has decided → an open question with a named arbiter.
4. **Closure sweep** — one line each, ID or justified `(none — reason)`:
   actors & permissions · prior state & lifecycle (incl. reversal) ·
   concurrency & retries · external-dependency failure · durability &
   recovery · security & privacy · accessibility · performance & scale ·
   observability · compound hazards.
5. **Rules**, each tagged with the **primary verification strategy** its
   shape suggests (rule → properties + boundaries; sequence → browser
   walk; contract → API tests; invariant → reconciliation arithmetic;
   judgement → corpus % + consistency). The tag is routing advice, not an
   exclusive taxonomy — add supporting strategies where needed.
   - Rule-shaped: example table (business-signable, "Why?" column,
     `rejected` sentinel) **and** a one-sentence property.
   - Contract-shaped: **name the address** (`DELETE /api/table_def/:name`)
     — a contract without its route isn't one; that is the contract's
     identity, not implementation detail. An example table is optional:
     where rows would only restate the rule, enumerate the behaviours
     instead (trial #1 finding).
   - Judgement-shaped: split **conformance** (implements the approved
     algorithm and named constants — deterministic) from **fitness**
     (useful over a labelled corpus — empirical, scored as %).
   - Thresholds are named constants where they're consumed; register
     cross-cutting ones in an ADR (precedent: ADR 0008).
6. **Invariants and hazards.** Whole-run arithmetic; compound risks no
   single rule owns get hazard IDs.
7. **Evidence verdicts** — grammar in `references/evidence-schema.md`.
   One `> evidence: proven | rule-tier | gap | pinned #N — <note>` line
   under each journey, rule, invariant and hazard. Test titles quote spec
   IDs (static traceability: a linkage claim, never execution evidence);
   where the proving title does not, name it with `via <ID>`. Run
   `pnpm check:evidence` before you call the spec updated.
8. **Tests from the spec.** Journeys give the browser test its skeleton
   (feather-testing-core chains; the author still owns setup, isolation,
   waits, adequacy). Properties/boundaries prove rules; reconciliation
   proves invariants. Dialogs collide with text-addressed verbs (the
   dialog's "Delete" under the page's "Delete Table") — scope with
   `within(dialogSelector, s => s.clickButton(…))` before falling back
   to `step()` (trial #1 finding).

## Standing rules (the corrected set)

- **No automatic precedence between artifacts.** Approved requirements
  define intended behaviour; code is the current implementation; tests
  are verification claims; results are evidence; an observed undocumented
  behaviour is a finding with three fates — ratified, filed as a defect,
  or raised as a question — and the owner chooses. On any disagreement,
  classify: implementation defect / incorrect test / stale requirement /
  unresolved decision / environmental failure.
- **Disagreement blocks, never tiebreaks.** Statement vs example vs
  property conflict = inconsistent requirement; the owner arbitrates; all
  representations update together.
- **Pins assert the SPEC, expected-failing.** A known defect is pinned
  with `it.fails`/`test.fail` whose assertion states intended behaviour,
  tagged with its issue; fixing the defect flips the pin loudly. A
  passing assertion of wrong behaviour is never a pin — where an
  expected-failing test is impractical, weaken to a neutral assertion and
  record `known-gap` with no evidence claim.
- **No expectation laundering** (see CLAUDE.md hard rules).
- **IDs**: `FEAT-J1`/`FEAT-R3`/`FEAT-I1`/`FEAT-H1`/`Q1`; steps positional;
  a clause needing independent citation gets a stable sub-ID at that
  moment (`R2.7` precedent) — never pre-exploded.
- **The spec body stays timeless; the verdict line carries the status.**
   Prose says what *should* be true and never what is done; the one
   `> evidence:` line per obligation says what is proven, and git dates
   it — never stamp a date by hand.

## Change protocol

Behaviour changes on purpose → the requirement changes first, the new
expectation demonstrably fails against the old implementation, then the
code changes. A test failing with no spec edit is a regression. An
answered question graduates into a rule or step. Update the evidence
verdict in the same change as the tests it describes, and let
`pnpm check:evidence` confirm the linkage.
