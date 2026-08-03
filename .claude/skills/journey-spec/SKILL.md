---
name: journey-spec
description: >
  Author or retrofit a Featherbase feature spec in the journeys-and-rules
  form: narrative journeys with step triples, shape-tagged rules with
  example tables and properties, invariants, hazards, open questions with
  a named arbiter, and a CSV evidence matrix. Use when writing
  requirements for a new feature, recovering a spec from shipped
  behaviour, or updating spec/evidence after building. Full rationale:
  docs/design/requirements-framework.md.
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
| `docs/specs/NNNN-<feature>.md` | Markdown | Narrative + tables — what humans sign and agents author. Never HTML. |
| `docs/specs/evidence/<feature>.csv` | CSV | Genuinely tabular, diffable, and the exact shape that later lands as rows in Featherbase itself (dog-fooding). One row per obligation. |
| Fixture files | Real files (`e2e/fixtures/*.csv` + a `.claims.md`) | The agreement dataset the tests literally load. |
| Review artifact | HTML, **generated** | A view rendered from the md + CSV, never a source. Regenerate on change; today an agent renders it from the template of the existing artifact; later Featherbase renders it from the same rows. |

HTML is a presentation format, not a source format: verbose to edit,
hostile to diffs. Markdown carries prose; CSV carries the enumerable
layer; HTML is always downstream.

## Authoring steps

1. **Job + fixture.** One sentence per job. One deliberately benign
   agreement fixture, designed so each column/field exercises a different
   rule; state its limits (hostile-space coverage lives in properties).
2. **Journeys** (2–3): the walk told once, each step a triple
   *(where am I, what do I do, what must I observably see)* — every "see"
   an observable at a declared boundary. Loops are repeating groups;
   durable failure states are named states. Each journey states its
   **isolation strategy**; a skip is never a pass.
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
   - Judgement-shaped: split **conformance** (implements the approved
     algorithm and named constants — deterministic) from **fitness**
     (useful over a labelled corpus — empirical, scored as %).
   - Thresholds are named constants where they're consumed; register
     cross-cutting ones in an ADR (precedent: ADR 0008).
6. **Invariants and hazards.** Whole-run arithmetic; compound risks no
   single rule owns get hazard IDs.
7. **Evidence CSV** — schema in `references/evidence-schema.md`. Test
   titles quote spec IDs (static traceability: a linkage claim, never
   execution evidence); verdicts and stamps carry the execution truth.
8. **Tests from the spec.** Journeys give the browser test its skeleton
   (feather-testing-core chains; the author still owns setup, isolation,
   waits, adequacy). Properties/boundaries prove rules; reconciliation
   proves invariants.

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
- **Spec stays timeless; evidence stays stamped.** Status never appears
  in the spec body; every evidence row carries its stamp; an unstamped
  row is a hypothesis.

## Change protocol

Behaviour changes on purpose → the requirement changes first, the new
expectation demonstrably fails against the old implementation, then the
code changes. A test failing with no spec edit is a regression. An
answered question graduates into a rule or step. Update the evidence CSV
in the same change as the tests it describes.
