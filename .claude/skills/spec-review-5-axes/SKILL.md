---
name: spec-review-5-axes
description: Review a specification against five axes — world vs machine, governed vs characterized, falsifiable, complete over its input space, and bound to an executable. Also the home of the STC divergence triage, the routed decision emitted when spec, test and code disagree. Use when writing or reviewing a spec in docs/specs or openspec/specs, when a spec was recovered from shipped behaviour, when spec and code appear to disagree, before implementing from a spec, or when the owner says "review the spec", "is this spec any good", "spec review using 5 axes", or "spec vs code". Carries the requirements-engineering harvest — Jackson & Zave's S ∧ D ⟹ R, Parnas tables, Adzic's specification by example, Lamport on what-not-how — and an explicit REJECT list so sign-off ceremony and traceability-to-business-objective do not get imported by accident.
---

# spec-review-5-axes

## Overview

Five axes for reviewing a specification, plus the **divergence triage** — the output format all three review skills use when the artifacts disagree.

**Prerequisite, not restated here:** the three framing rules in **`code-review-8-axes`** — unknown unknowns are the binding failure mode, the owner is the binding reader, prose cannot fail. **A spec is the purest case of "prose cannot fail"**: it is entirely prose, so nothing in it can break.

Ported from the data-warehouse repo (#3691, from a design conversation with Siraj, 16/17-Sep-2026, prompted by a reverse-engineered spec that contradicted its own code). The axes are that skill's; the examples were re-derived from this repo's specs on 18-Sep-2026.

**This repo already has a requirements framework, and it is not a lesser one.** `docs/design/requirements-framework.md` (ratified 2026-08-28) defines the journeys-and-rules form, the evidence verdicts, the shape tags, the closure sweep, negative space and assertion polarity, and — in §4 — a treatment of un-oracled judgement that these five axes do **not** have. Read the map before reviewing:

| Axis | Does the local framework already hold it? |
|---|---|
| 1 — World or machine | **No.** The closure sweep has an *external-dependency failure* slot, which is about what happens when a dependency breaks, not about which statements are assumptions we do not control. This axis adds something. |
| 2 — Governed or characterized | **Partly.** `CLAUDE.md`'s *"a discovered behaviour is not a requirement"* is the rule; what is missing is a per-requirement **label**, so a reader of a retrofit spec can tell which is which. |
| 3 — Falsifiable | **Yes, and further.** §4 "Judgement has no oracle" splits conformance from fitness and scores heuristics against a corpus rather than passing/failing them. Do not overwrite that with a cruder "make it falsifiable". |
| 4 — Complete over its input space | **Yes.** The example-table discipline and the `shape:` tags already produce Parnas-style tables. This axis is a check, not a new practice. |
| 5 — Bound to an executable | **Yes, and mechanised.** The `> evidence:` verdict plus `tools/check-evidence.mjs` — static *and* runtime — is a stronger binding than the origin repo has. |

So a review here spends its time on **Axes 1 and 2**, checks 3–5, and does not lecture the format about things it already does better.

---

## The triangle

| Artifact | Question it answers | Skill |
|---|---|---|
| **Spec** | What should the system promise? | this one |
| **Code** | Does it hold those promises? | `code-review-8-axes` |
| **Test** | Is each promise actually checked? | `test-review-3-axes` |

They drift apart continuously — whichever was written first, and however carefully one was generated from another. Agreement at a moment is not a property that persists. The edges are made greppable by **`docs/agents/stc-traceability.md`**; `pnpm check:evidence` computes spec↔test for `docs/specs` and `pnpm check:stc` computes spec↔code↔test for `openspec/specs`.

---

## The divergence triage — the most important output

**Never silently pick a winner.** The two default failures are equally bad: an agent "fixing" code to match a stale spec, and an agent quietly updating the spec to match buggy code — which launders a bug into a requirement. `CLAUDE.md` forbids the second by name (*"No expectation laundering"*). **But never punt either.** A disagreement handed over with no view is a tax on the owner.

Emit this, one per disagreement:

```
DIVERGENCE  cutoff_applied_to_both_sides
  SPEC  "data_through: least(period_end, source_as_of) -- the cutoff ACTUALLY
         APPLIED to both sides"          apps/server/src/sales-target-report.ts:46
  CODE  three independent reads of max(actuals_as_of_date): the snapshot's
        as-of (datasets/sales-target-mtd.ts:61), the rows query's own cutoff
        CTE (:34) and the live path (:156). Separate statements, separate
        connections, separate moments; nothing compares them.
  TEST  cannot see it. dataset-snapshot.test.ts:40's stub answers the as-of
        query and the rows query from ONE constant, so the disagreement is
        impossible under test.
  RECOMMEND  the SPEC is right and the CODE cannot currently honour it. Read
             the as-of once and pass it into the rows query, so one value
             decides both; then the sentence becomes true by construction.
  IF INSTEAD  two reads are kept, the spec must say "source_as_of is the
             boundary observed at fetch time and may differ from the cutoff
             applied to the rows" -- and the surface should stop calling it
             "the cutoff actually applied", because a reader is entitled to
             believe that sentence.
```

Four rules:

1. **Always recommend**, and **always say what follows if the owner rules the other way.** That second half is what makes it a decision rather than a quiz.
2. **Silence is a fourth outcome, and the most common.** Spec silent + code does something = either undocumented behaviour or an accident nobody chose. Route it too — this repo's rule is that a discovered behaviour has three fates (ratified, defect, open question) and the choice is the owner's.
3. **Cite all three vertices**, including "nothing" — an absent test is evidence about how the divergence survived.
4. **One triage item per disagreement.** Do not bundle.

---

## Axis 1 — World or machine

**Rule.** Every statement is exactly one of three things, and mixing them is the root cause of most specification failure.

**Source.** Michael Jackson & Pamela Zave, *Four Dark Corners of Requirements Engineering* (1997); Jackson, *Problem Frames*.

| | What it is | Example from this repo |
|---|---|---|
| **R** — Requirement | what the user needs, in the world's terms | "I built a table as an experiment and I need it gone — completely, not hidden" (`0003`'s DEL-J1) |
| **D** — Domain assumption | a fact about a world **you do not control** | "stored file bytes are only ever served through a registry lookup" — true today, and the reason DEL-R7 may be best-effort |
| **S** — Specification | behaviour at the **interface you do control** | "deletion removes every row whose column is declared `Reference → Table`" |

The correctness criterion:

> ## S ∧ D ⟹ R
> Your specification, **together with your domain assumptions**, must entail the requirement.

**The test.** For each statement: *is this about something we control?* If not, it is a **D**, and it belongs in a Domain assumptions section — not mixed in with the SHALLs.

**Why this matters more here than it looks.** A metadata-driven platform binding to **foreign databases** is a machine whose correctness rests almost entirely on assumptions about other people's systems. `docs/specs/0001-external-data-sources.md` is dense with them and has **no Domain assumptions section**, so they are spread through the SHALLs where a reader cannot tell them apart:

- *the foreign table's primary key is stable and single-column* — an assumption about someone else's schema
- *`docstatus` on a Frappe-shaped source means 0/1/2 with our meanings* — an assumption about another product's semantics
- *a foreign `modified` column advances on every write* — an assumption about someone else's triggers, on which optimistic locking rests

Each of those can be false while our code is perfectly correct, and then the requirement is violated anyway. **You cannot unit-test a domain assumption** — there is no branch, and the code is right. Domain assumptions need **monitoring or a probe against reality**, not a test.

**Every D gets four fields**: the assumption, how it was established, **when**, and **what would detect its violation**. An undated D is a guess with a citation. `openspec/specs/table-deletion/spec.md` carries the section in the shape this axis asks for — three assumptions, each with a *Detected by* line, two of which honestly say "nothing".

**Real gap, stated plainly:** not one spec in `docs/specs` has a Domain assumptions section, so the most dangerous statements in an external-data-sources feature are written down nowhere as assumptions. That is the single highest-value thing this axis adds to this repo.

---

## Axis 2 — Governed or characterized

**Rule.** Every requirement is one of two kinds, and they demand **opposite verdicts** on a disagreement.

| Kind | What it is | Code disagrees → |
|---|---|---|
| **Governed** | an authority — what the system *must* do | **the code is wrong.** Fix the code. |
| **Characterized** | an observation — what it *currently* does | **either could be wrong.** Decide, fix one, relabel. |

**Source.** Michael Feathers, *Working Effectively with Legacy Code* — the characterization test, one level up. Pinning current behaviour when nobody knows what it *should* be is legitimate and valuable. **The defect is never pinning; it is pinning silently**, so a later reader mistakes "this has not changed" for "this is correct."

**The test.** *If the code disagreed with this line tomorrow, would that automatically mean the code is wrong?* Yes → governed. No → characterized.

**Where this repo is exposed: the retrofits.** `docs/specs/0008-spreadsheet-import.md` declares its provenance honestly — *"retrofit, 2026-09-04 — the wizard's behaviour recovered from what shipped"* — and `docs/specs/0007-table-lifecycle.md` carries `test.fails` pins for behaviour the API violates today. A spec recovered from shipped behaviour is **characterized by default**, and the document-level note is not enough: it says *this document* was recovered, not *which of its 80 obligations* were a decision and which were an observation. A reader six months out cannot tell whether IMP-R8's coercion order was chosen or merely found.

**Fix shape.** One field per obligation: `Status: governed` or `Status: characterized (#197)`. Cheap, and it is what makes a retrofit safe to act on — without it, every review re-litigates "is this a bug or a requirement?" from scratch. The migrated `openspec/specs/table-deletion/spec.md` carries the field on all fourteen; `0003` (spec-first, zero rule changes during the build) is the easy case, and a retrofit is where the label earns its keep.

**And the asymmetry to expect in any recovered spec.** Accuracy varies *per requirement*, depending on whether the author resolved to an executable predicate or to a comment — and nothing records which. So when reviewing one, **check that each evidence pointer actually reaches the code that decides the behaviour.** A pointer naming the caller while the behaviour lives in the callee is how drift survives review. In this repo the pointer is often a test title rather than a symbol, which is stronger for the test edge and weaker for the code edge — `@spec` markers (`docs/agents/stc-traceability.md`) exist to close that side.

---

## Axis 3 — Falsifiable

**Rule.** A SHALL that no observation could contradict is not a requirement. It is prose.

**Source.** Popper's falsifiability, plus RFC 2119 discipline on SHALL/MUST/SHOULD/MAY.

**The test.** *What would I observe if this were violated?* If you cannot answer in one sentence, either sharpen it or move it to Purpose — where aspiration belongs and does no harm.

**Example.** *"Deletion removes what creation wrote"* is weaker than the table under DEL-R2, which names the definition row, the column definitions, the physical table, the child **rows**, and what is deliberately **kept**. Only the second can fail.

**Do not apply this crudely to judgement.** `docs/design/requirements-framework.md` §4 is ahead of this axis: a heuristic ("should a nine-value column become a Choice?") has **no oracle**, and demanding a falsifiable SHALL of it produces a false one. The framework's answer — split the oracle into **conformance** (the code implements the approved algorithm and its named constants: test normally) and **fitness** (the heuristic is useful: score against a corpus, report a percentage, never pass/fail) — is the right treatment, and a reviewer should enforce *that* rather than this axis's blunt form. The `shape: judgement` tag is how the format marks it; when you meet one, check the constants are named and the corpus is acknowledged as synthetic, not that the sentence can fail.

**Note the ordering with Axis 5.** Falsifiable is about the requirement's *wording*; bound is about whether an artifact checks it. **Falsifiability is a precondition** — an unfalsifiable requirement cannot be bound to anything, so fix the wording first.

---

## Axis 4 — Complete over its input space

**Rule.** For any state machine, status vocabulary, or decision with more than two inputs: the spec is a **table**, and every cell is defined exactly once.

**Source.** David Parnas — the SCR method; Parnas & Madey's Four-Variable Model (1995).

Parnas's complaint: **prose cannot be checked for completeness or determinism.** Tables can:

- **Complete** — no undefined cell
- **Disjoint** — no cell with two answers

**The test.** Can you build the table? Are there empty cells? Two answers anywhere?

**This repo already does this, and the example tables are why.** DEL-R3's six rows are a Parnas table in the journeys-and-rules form: for each shape of dependency, the verdict and the reason. The migrated spec tabulates the same six with an explicit evaluation order, which is the one thing the prose version leaves implicit — *which* refusal a system Table with a Reference pointing at it receives.

**So the finding this axis produces here is usually "the table exists but its ordering is implicit", not "there is no table".** Reach for a full table when the subject is a state machine, a status vocabulary, or a multi-input decision; most requirements are fine as a sentence, and the framework's own retrospective already records that contract-shaped rules get thin example tables (`0003`'s retrospective, point 2) — do not manufacture them.

**Related, and cheap:** the *small scope hypothesis* (Daniel Jackson, *Software Abstractions*) — most bugs show in small instances. You do not need exhaustive coverage; you need **complete coverage of a small space**.

---

## Axis 5 — Bound to an executable

**Rule.** Every requirement names the test that checks it and the assertion that enforces it — or states that neither exists.

**Source.** Gojko Adzic, *Specification by Example*; Cyrille Martraire, *Living Documentation*; Meyer's Design by Contract, one level up.

Adzic's claim: **a specification that cannot be executed will rot, and the only reliable anti-rot mechanism is to bind the spec and the test together.** Not "traceable to" in a spreadsheet — bound by a token a script checks.

**This repo is the strong case, not the weak one.** `> evidence: proven | rule-tier | gap | pinned #N` sits under every obligation, and `tools/check-evidence.mjs` re-derives the linkage from the test titles in CI, twice: statically before install, and again after the suites run, where a `proven` verdict backed only by tests that were **skipped at runtime** fails. It refuses to let a spec opt out silently, refuses a skipped test as proof, and refuses a counterfeit pin. That is further than most projects get.

**What it does not do is the code edge.** The join is spec ↔ test *title*; nothing points at the line that decides the behaviour. `pnpm check:stc` and the `@spec` marker close that for `openspec/specs`.

**The test.** Run `pnpm check:evidence` and `pnpm check:stc`. A requirement with no test is an unverified promise; an orphan marker is a rename that was left half-finished.

**And the trap this axis is really for** — from `code-review-8-axes` Axis 8, applied to the spec's own tooling:

> `openspec validate --specs --strict` passing means the spec is **well-formed, not true.** It reported *1 passed, 0 failed* on `openspec/specs/table-deletion/spec.md` before a single requirement had been read against the code. A spec with a green validator and no drift detection is an **unenforced guard** — worse than no spec, because a document saying SHALL makes the next agent stop looking.

The same caution applies to a green `check-evidence` run: it proves a **matching test title exists and executed**, never that the test asserts the thing. Its own header says so — *"What this check cannot see, stated plainly: whether an executable test asserts anything."*

---

## A defect that is none of the five, and which this repo produces

**A spec that speaks retired vocabulary.** `docs/specs/0001-external-data-sources.md:152–153` says *"SHALL reject `submit`, `cancel` and `amend` for that **DocType**"* and *"reject any `if_owner` **DocPerm**"*. Those are Frappe's names for concepts this product renamed to **Table** and **Permission** (`docs/GLOSSARY.md`), and `CLAUDE.md` is explicit that the old vocabulary survives only where it is a dated record of the past. A live Proposed spec is not that.

Do not fold this into an axis — it is a **vocabulary check**, cheap and mechanical:

```
grep -nE '\b(DocType|DocPerm|doctype|docstatus|frappe\.)' docs/specs openspec/specs
```

and then the judgement that matters: **which system does the word belong to?** In the same file, `docstatus` at line 146 names a column on a **foreign Frappe table** and is correct. At line 152 it names ours and is not. Axis 6 of `code-review-8-axes` is the same test applied to code.

---

## How to run a review

1. **Classify every statement** — R, D or S (Axis 1). The D list is usually the most valuable thing the review produces, because here it is usually missing entirely.
2. **Label each requirement** governed or characterized (Axis 2). Do this before anything that depends on who wins a disagreement, and do it first on any retrofit spec.
3. **Check each evidence pointer actually reaches the deciding code.** A citation naming the caller while the behaviour lives in the callee is how drift survives review.
4. **Falsifiability pass** (Axis 3) — respecting `shape: judgement` — then **tables** for anything state-machine-shaped (Axis 4).
5. **Run `pnpm check:evidence` and `pnpm check:stc`** (Axis 5). Report orphans as failures, gaps against the baseline. Then run the vocabulary grep above.
6. **Verify before reporting.** Read the code the requirement describes; do not trust the spec's own citation. Mark each finding **VERIFIED** or **UNVERIFIED** and never present the second as the first. In the trial that produced these skills, the most thorough reviewer produced a confident, specifically-cited, **fabricated** correction, and the fastest one reported findings it had read in the skill while sincerely believing it had found them. **Self-assessment is not reliable.**
7. **Emit divergence triage items**, one per disagreement. Do not fix the code and do not edit the spec — this review routes decisions; it does not settle them. `CLAUDE.md`: the choice is the owner's, never an agent's.

### Output format

Lead with the **domain assumptions** you extracted — they are the highest-value artifact and they usually exist nowhere else. Then the triage items. Then per-axis findings. Close with a count per axis, the evidence/STC summary, and a **refuted list** — every suspicion investigated and dropped.

---

## The REJECT list

| Rejected | Why |
|---|---|
| **Sign-off ceremony / spec freeze** | Artifacts of a world where specs precede code once. This is a living document in a repo where several agents commit a day. |
| **"Every requirement traces to a business objective"** | Produces a column nobody reads. The useful trace is to a **test**, which a script can check. |
| **Completeness of the document** | A spec that covers everything is the code. If the spec approaches the size of the code, it *is* the code and will rot. `0003`: 375 spec lines against an 87-line deletion path — watch that ratio in the other direction too; a spec can be *thick* relative to a small capability and still earn it, if the thickness is journeys and hazards rather than restated implementation. |
| **Specifying the implementation** | Lamport's test: *could two very different implementations satisfy this?* If only yours can, it is a **design**, not a spec. Note the local exception, ratified in `0003`'s retrospective: a contract-shaped rule names its route (`DELETE /api/table_def/:name`), because a contract without its address isn't one. |
| **Rationale inside the spec** | The spec says *what must be true*; the ADR says *why we chose it*; the issue says *what happened*. A spec carrying rationale rots at the rate of the rationale. |
| **Hierarchical numbering (`3.73`, `4.1.2`)** | Encodes position in a document, so inserting a requirement renumbers its neighbours and old citations silently point elsewhere. This repo's `DEL-R3` scheme is **not** hierarchical numbering and is not condemned here — it is a flat prefixed counter, and 87 of them are in circulation. The slug convention (`docs/agents/stc-traceability.md`) argues it can be improved on; that is a live comparison, not a settled verdict. |

---

## Provenance

| Idea | Source |
|---|---|
| `S ∧ D ⟹ R`; world vs machine; shared phenomena | Jackson & Zave, *Four Dark Corners of Requirements Engineering* (1997) |
| Tabular specs; completeness and determinism | Parnas, SCR; Parnas & Madey, Four-Variable Model (1995) |
| Specification by example; living documentation | Gojko Adzic (2009, 2011); Cyrille Martraire (2019) |
| Characterization as a legitimate, labelled tool | Michael Feathers, *Working Effectively with Legacy Code* |
| What, not how; a spec smaller than its code | Leslie Lamport, *Specifying Systems* (2002) |
| Small scope hypothesis | Daniel Jackson, *Software Abstractions* (2006) |
| SHALL/MUST/SHOULD/MAY discipline | RFC 2119 |
| Framing rules; unenforced guards | `code-review-8-axes` |
| Promises as the unit; the ratchet | `test-review-3-axes` |
| Journeys, shapes, closure sweep, split-oracle judgement, evidence verdicts | `docs/design/requirements-framework.md` (this repo, ratified 2026-08-28) |
