# OpenSpec vs the journey-spec form — the evaluation, with one capability migrated

**Status: open question. The arbiter is Siraj. Nothing here is decided.**

OpenSpec was installed in this repo on 2026-09-18 (`openspec/`, six `opsx:` skills)
so the question *"should `docs/specs` move to OpenSpec?"* could be answered from a
real migration rather than from a description of one.
`docs/specs/0003-table-deletion.md` — the first greenfield trial of the journey-spec
format, spec-first, built and proven with **zero rule changes** — was migrated to
`openspec/specs/table-deletion/spec.md`. This document reports what survived, what
did not, and what the migration is actually buying.

**Both files are in the repo and they say the same things.** That is a sanctioned
duplicated fact with a known expiry: when the question is ruled, one of them is
deleted. It should not outlive the decision, because two accountable documents about
one capability is exactly how two specs come to disagree — `docs/specs/0008` names
that failure mode in its own header.

**`docs/specs/0003` remains the live document** until then. `tools/check-evidence.mjs`
scans `docs/specs` only, so the migrated copy is checked by nothing but
`pnpm check:stc`'s linkage.

---

## The headline

The two questions are separable, and conflating them is the main risk in this decision:

1. **Is OpenSpec's *shape* better than journeys-and-rules?** On the evidence below —
   no. The local form carries five things OpenSpec has no slot for, and four of them
   were *earned* through use and recorded in `0003`'s own retrospective.
2. **Is the *traceability* the data-warehouse repo built on top of OpenSpec worth
   having?** Yes — and **none of it requires OpenSpec.** The `@spec` slug, the matrix,
   the domain-assumptions section and the governed/characterized label are all
   additive conventions that would work unchanged over `docs/specs`.

There is a third thing OpenSpec brings that the local form genuinely lacks — a
**change workflow** (propose → delta spec → apply → archive, with `opsx:` skills that
agents already know). That is orthogonal to spec form and can be adopted or declined
on its own.

---

## Method

- Every obligation in `0003` — 2 journeys, 9 rules, 2 invariants, 1 hazard, 3 ruled
  questions — was carried across. Nothing was dropped to make the target form fit.
- Requirement slugs are snake_case per `docs/agents/stc-traceability.md`, with
  `Legacy ID: DEL-R3` recorded on each so the 87 IDs already in circulation across
  code comments, test titles and issue threads keep resolving.
- `@spec` markers were added at the deciding lines in `apps/server/src/table-engine.ts`
  and `meta.ts`, and beside the 17 tests that check them.
- Verified: `npx @fission-ai/openspec validate --specs --strict` → 1 passed, 0 failed.
  `pnpm check:stc` → 14 requirements, 10 with code, 14 with a test, no orphans.
  `pnpm check:evidence` → unchanged, still green. Both typechecks clean.

Size: **375 lines → 418** (+11%) for the same obligations. The growth is the added
domain-assumptions section and the per-requirement `Status:` / `Evidence:` /
`Legacy ID:` fields — not restated content.

---

## What the migration LOST

Each of these is a slot the journeys-and-rules form has and OpenSpec's
`Requirement / Scenario` shape does not. Four are named in `0003`'s retrospective as
things that earned their keep.

| Lost | What it was | Why it matters |
|---|---|---|
| **The step triple** | `\| # \| Where / do \| Must observably see \| Rules \|` — J1's five numbered steps | *"Step triples translated 1:1 into the feather-testing DSL"* (`0003` retrospective §8). A `WHEN/THEN` scenario is a weaker container: it loses *where the user is*, and it loses the step number that `J1.4` cites. I flattened five steps into two scenarios and the browser walk's shape is gone from the document. |
| **The closure sweep** | the mandatory checklist — actors, prior state & reversal, concurrency, external-dependency failure, durability, security, accessibility, performance, observability, compound hazards | *"The highest-value section per minute. It forced the Access-Log-survives / Import-Log-swept distinction, the bound-table line, and the series-survival cross-ref — none of which the journeys alone would have surfaced. **Keep it mandatory.**"* (§3). OpenSpec has no counterpart; in the migration its content survives only because it had already become rules R4–R8. **The generative act is what was lost, not the text.** |
| **The isolation strategy** | per journey: how it cleans up, and whether a skip path exists | *"Made J1's self-cleaning design a requirement rather than an afterthought"* (§8). It is a promise about the *test*, which is exactly the kind of thing a `Scenario` cannot hold. |
| **"Bug if"** | the fourth field per step (ratified 2026-09-04, `0008`) | One clause naming what going wrong at *this* step looks like. No home in the target form. |
| **The language split** | journeys in the user's language; implementation nouns only in rules | An enforceable review test — *"could this step's 'must observably see' be read off the screen by someone who has never seen the code?"* OpenSpec's shape neither encourages nor forbids it. |
| **CI enforcement of evidence** | `> evidence:` verdicts, checked statically and at runtime by `check-evidence.mjs` | The verdicts migrated as `Verdict:` prose. **Nothing checks them there.** Repointing the checker at `openspec/specs` is possible but is a second job, and its participation rules (`**IDs:**` declaration, excluded-document rule) assume the local format. |
| **The retrospective** | `0003`'s §"where the format chafed" | Written after building, it is why four of these rows can be argued from evidence instead of taste. The migrated file has nowhere to put it, and I did not carry it. |

---

## What the migration GAINED

| Gained | Comes from | Would it work over `docs/specs` as it stands? |
|---|---|---|
| **Domain assumptions** — `S ∧ D ⟹ R`, each with established-by / when / **detected-by** | the data-warehouse conventions, not OpenSpec | **Yes.** It is a section heading. No spec in `docs/specs` has one today, and for a product that binds to *foreign databases* this is the highest-value single addition available — see `spec-review-5-axes` Axis 1. |
| **`Status: governed \| characterized`** per requirement | same | **Yes.** Most valuable on the retrofits (`0008`, `0009`), where the document-level provenance note cannot say *which* of 80 obligations was a decision and which was an observation. |
| **snake_case slugs + `@spec` markers + the matrix** | `docs/agents/stc-traceability.md` | **Yes, with one change.** `tools/stc-matrix.mjs` keys on `### Requirement: <slug>`; pointing it at `docs/specs` needs a different heading regex and a decision on whether `DEL-R3` or a slug is the token. The *mechanism* is form-independent. |
| **`openspec validate --strict`** | OpenSpec | Well-formedness only. It reported **1 passed, 0 failed** on the migrated file before a single requirement had been read against the code. Do not count this as a quality gate. |
| **The change workflow** — `opsx:propose`, `apply`, `archive`, delta specs | OpenSpec | **No — this is the one thing that genuinely needs it.** `docs/specs` has no proposal/delta/archive lifecycle; changes are edits. If that lifecycle is wanted, OpenSpec is a real answer. |
| **A shape agents already know** | OpenSpec | Mild but real: `Requirement/Scenario` + the `opsx:` skills are a convention a fresh agent recognises without reading `requirements-framework.md` (720 lines). Weigh against: the local form's judgment is *in* those 720 lines. |

---

## The traceability measurement, which is the part that surprised me

This repo already carries its obligation IDs in all three vertices **by hand**.
Measured 2026-09-18:

| | count |
|---|---|
| obligation IDs declared in `docs/specs` headings | 87 |
| distinct IDs cited in a test title | 54 |
| distinct IDs cited in `apps/*/src` or `packages/*/src` | 39 |

So the convention the data-warehouse repo introduced with `@spec` **already exists
here in a different dialect**. What was missing is not the marker; it is the *script*
that computes the matrix and fails when a vertex is left behind — and `check-evidence.mjs`
does not close it, because it joins the spec to test **titles** and never looks at code.

**That is the finding that decides how much OpenSpec is worth.** If the goal is
spec↔code↔test traceability, the cheapest path is to point `stc-matrix.mjs` at
`docs/specs` and keep the existing IDs. Migrating 3,791 lines of spec is not required
to get it.

---

## Where the slug convention is genuinely better, and where it is not

**Better:** `stale_pointer_gets_tombstone` is derivable from the requirement's title,
so an agent can cite it without a file read, and a human reads it in a PR comment and
knows what is being discussed. `DEL-R9` requires opening the file, every time.

**Not better:** `DEL-R3` is shorter, sorts, and is already in 87 places. A rename of
all of them is a large mechanical change whose only failure mode is silence — a missed
citation does not break anything, it just stops meaning something. The migrated spec's
`Legacy ID:` line is the hedge; carrying both forever is the cost of the hedge.

**A middle option nobody has costed yet:** keep `DEL-R3` as the ID and add the slug as
an *alias* on the heading, teaching the matrix both. It buys the derivable handle
without touching a single existing citation.

---

## Recommendation (for the arbiter to rule on, not a decision)

1. **Do not migrate `docs/specs` to OpenSpec.** The journeys-and-rules form carries
   more, and the four things it carries that OpenSpec cannot were earned through use
   and written down as such.
2. **Adopt the three additive conventions into the local form**, where they cost a
   section heading each:
   - a **Domain assumptions** section (highest value on `0001`, `0006`, `0009`);
   - a **`Status: governed | characterized`** field per obligation (highest value on
     the retrofits);
   - the **spec↔code edge** — point `stc-matrix.mjs` at `docs/specs`, decide ID vs
     slug vs alias, and let it ratchet.
3. **Decide the change workflow separately.** If the proposal → delta → archive
   lifecycle is wanted, keep OpenSpec for *that* and leave the specs where they are.
   If not, remove `openspec/` and the `opsx:` skills rather than leaving an unused
   root that a future agent will read as the house format.
4. **Either way, delete one of the two table-deletion specs** when this is ruled.

**The three review skills do not depend on this ruling.** `code-review-8-axes`,
`test-review-3-axes` and `spec-review-5-axes` were written against this repo's own
code, tests and specs, and `spec-review-5-axes` names both spec homes. They stand
whichever way the format question goes.
