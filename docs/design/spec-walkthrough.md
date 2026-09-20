# The author's walkthrough — one requirement, end to end

**Status:** first edition, written 2026-09-20 · **Reading time:** ten minutes

`docs/design/requirements-framework.md` §5 has asked for this document since
the framework was written, and gave the reason:

> Before the format is declared adopted, write the **author's walkthrough**:
> one trivial requirement traced through every artifact it touches — spec row,
> test title, evidence verdict, CI check. Cost of adoption is dominated by the
> first hour; this is that hour, written down.

That hour is below. It follows **one** requirement — deliberately the smallest
real one in the repo — from the sentence a person argued about to the CI job
that refuses to let the sentence rot. Nothing here is new machinery; it is the
existing machinery walked once, slowly.

Read `docs/specs/0005-import-revert.md` alongside it. That spec is the
recommended first read: 251 lines, **one** journey, six rules, seven verdicts —
the smallest document that is genuinely in the form.

---

## The requirement

> **RVT-I3 — a second identical revert is a no-op.**

That is the whole thing. Someone reverted an import run, then clicked revert
again — by accident, or because the page was stale, or because they were not
sure the first one worked. Nothing should happen the second time, and the
report should say so rather than sitting silent.

It is an **invariant**: a statement that must hold across every path, not a
step in a journey and not a contract on one endpoint. The form has a slot for
that, which is why it has a home.

---

## Artifact 1 — the spec entry

`docs/specs/0005-import-revert.md:220`

```markdown
- **RVT-I3 — a second identical revert is a no-op.** The first revert
  moved every restored row's stamp; the second finds no stamp matches and
  skips everything — zero writes, and the report says so.

  > evidence: proven — the second revert restores zero and deletes zero,
  > names every skip (edited-after for the restored rows, whose stamps
  > moved, and already-gone for the deleted ones), and leaves the table
  > state identical.
```

Two parts, doing two different jobs.

**The claim** (the bold line plus its sentence) is what we promise. Note what
it does *not* say: it does not name a route, a function, a table or a column.
It says what a person doing the thing twice will observe. That is
`requirements-framework.md` §11, which keeps implementation detail out of the
spec body — with one carve-out that does not apply here: a **contract**-shaped
rule may name its address (`RVT-R2` says `POST /api/table/:table:import-revert`)
because a route is the contract's identity. An invariant has no address, so it
names none.

It also carries its own *mechanism* in one clause — "the second finds no stamp
matches" — because without it a reader would reasonably ask "no-op *how*? does
it check a flag? a status?" The answer is neither: the no-op falls out of the
optimistic stamps `RVT-R4` already uses. One clause, and the invariant stops
looking like magic.

**The verdict** (`> evidence:`) is the machine-checked half. It is one line, it
starts with a status from a closed vocabulary — `proven` · `gap` · `pinned` ·
`rule-tier` — and the prose after the dash says *what was executed*, not what
the author believes.

---

## Artifact 2 — the test

`apps/server/test/import/revert.test.ts:275`

```ts
describe('RVT-I3: a second identical revert is a no-op', () => {
  test('RVT-I3: the first revert moved every stamp; the second writes nothing and says so', async ({
    admin,
  }) => {
    await setup(admin)
    const runId = await seedAndRun(admin)
    await admin.post<RevertRes>(REVERT, { run_id: runId })
    const between = await rowsByZone(admin)

    const second = await admin.post<RevertRes>(REVERT, { run_id: runId })
    expect(second.restored).toBe(0)
    expect(second.deleted).toBe(0)
    expect(second.failed).toEqual([])
    expect(second.skipped).toHaveLength(2) // edited-after (restored row) + already-gone (deleted row)
    expect(await rowsByZone(admin)).toEqual(between)
  })
})
```

Four things to notice, because each is a convention rather than an accident:

1. **The ID is in the title**, in both the `describe` and the `test`. That is
   the join key — not a file path, not a comment, not a registry. Titles were
   chosen over paths precisely so that moving a test file cannot break the
   evidence (see the 2026-08-28 entry in `PROGRESS.md`, where the old CSVs'
   path links had made the `import-*` reorganisation impossible).
2. **The title restates the promise**, so a failure in a CI log reads as a
   broken promise rather than a broken assertion.
3. **`admin` is a fixture**, not a mock. It is a real in-process HTTP client
   with a real JWT, talking to the real server, against a real Postgres
   transaction that is rolled back at the end (`feather-testing-postgres`, the
   Ecto SQL Sandbox model). There is nothing to clean up and nothing to stub.
4. **The last assertion is the invariant itself** — `rowsByZone` after equals
   `rowsByZone` between. The three count assertions check the *report*; this
   one checks the *world*. A test that only asserted the counts would pass
   against an implementation that wrote rows and lied about it.

---

## Artifact 3 — the join

Nobody maintains a mapping between the two. `tools/check-evidence.mjs` derives
it: for each `> evidence:` verdict it takes the obligation's ID and looks for a
test declaration whose title contains that ID.

```bash
pnpm check:evidence
# evidence check passed — 148 verdicts across 8 specs
# (66 gap · 2 pinned · 77 proven · 3 rule-tier); 224 test files scanned.
```

`proven` and `rule-tier` **must** link; `gap` and `pinned` have their own
rules. The whole join is re-derived on every run, so it cannot be stale — it
can only be right or failing.

---

## Artifact 4 — the CI gate, which is two gates

`.github/workflows/test.yml` runs the checker **twice**, and the difference
between the runs is the point.

**Static pass** (line 104), before anything is installed:

```yaml
run: node --test tools/*.test.mjs && node tools/check-evidence.mjs
```

The checker's own mutation tests run *first*. A checker nobody checks is the
`harness/evaluation/` mistake (`docs/archive/harness-2026/README.md`: a grading
protocol that existed on disk and never ran once).

**Runtime pass** (line 274), after both runner families have finished:

```yaml
run: node tools/check-evidence.mjs --results …
```

Now it is handed the actual Vitest and Playwright JSON. Every `proven` verdict
must match a test that **really executed** in that run. A test that exists but
was filtered out, excluded by config, or dynamically skipped no longer proves
anything.

---

## The five ways to break it, and what happens

This is the part worth internalising, because it is what makes the form
different from a checklist. Each of these was somebody's actual attempt, and
each is now a committed mutation test in `tools/check-evidence.test.mjs`
(`grep -cE "^\s*test\(" tools/check-evidence.test.mjs` for the current count).

| If you… | Then… |
|---|---|
| delete the `> evidence:` line | the obligation has no verdict; the run fails naming the file |
| change the verdict to `proven` with no matching test | no link for a `MUST_LINK` status; the run fails |
| rename the test, dropping `RVT-I3` from the title | same failure — the join is the title, and renaming breaks it on purpose |
| mark the test `.skip` | `skip` is not on the executable allowlist; a skipped test cannot prove. So is a skipped *suite* title — that was the fourth disguise, found while writing the fixtures |
| leave the test in place but exclude it from the run | static pass green, **runtime pass red** — this is the escape hatch #241 closed |

And the one that is *not* a failure, deliberately: a test that **ran and
failed** still counts as executed here. Its own suite already owns the red
verdict; the evidence checker does not try to be a second test runner.

---

## The same requirement in OpenSpec form

For comparison, here is RVT-I3 rendered the way `openspec/specs/` would carry
it. This is an illustration written for this document, not a committed file.

```markdown
### Requirement: Reverting twice changes nothing the second time
Legacy ID: RVT-I3 · Status: governed

The system SHALL treat a repeat revert of an already-reverted run as a
no-op: nothing is restored, nothing is deleted, and every row is reported
as skipped with its reason.

#### Scenario: the same run is reverted twice
- **Given** an import run that has been reverted once
- **When** the same `run_id` is reverted again
- **Then** the response reports `restored: 0` and `deleted: 0`
- **And** every row is named in `skipped` — `edited-after` for the
  restored rows, whose stamps moved; `already-gone` for the deleted ones
- **And** the table's rows are unchanged from before the second revert
```

**What the translation gains.** The scenario is more explicit than the
journey-spec sentence: a reader who has never seen this codebase can act on the
Given/When/Then without inferring anything. The `Status: governed` label states
that this was decided rather than observed — something the journey form leaves
to its provenance header. And `openspec validate --strict` checks the document's
own shape, which the journey form has no equivalent for.

**What the translation loses.** Three things, and they are the argument in
`docs/design/openspec-vs-journey-spec.md`:

1. **The verdict.** There is no slot for `> evidence:`, so nothing joins this
   requirement to `revert.test.ts:275`, and `check-evidence.mjs` does not watch
   this tree. The promise is stated more clearly and proved by less.
2. **The mechanism clause.** "The first revert moved every restored row's
   stamp" has nowhere to go that is not either a scenario step (where it is
   implementation detail) or prose above (where it drifts). It ends up dropped,
   and the no-op looks like magic again.
3. **The shape tag.** `shape: invariant` says *how this is to be proved* — over
   all paths, not by example. Rendered as a single scenario, an invariant
   becomes indistinguishable from a rule with one example row, and the next
   person writes one test instead of a property.

Neither form is strictly better here. The OpenSpec version reads better cold;
the journey version is bound to something executable. That is the whole trade,
in twenty lines, and it is why the recommendation is *take the additive
conventions, do not move the tree.*

---

## Reading order, if you are new

1. This document.
2. `docs/specs/0005-import-revert.md` — the smallest real journey spec. Read
   RVT-J1's table first; the three columns (where/do · must observably see ·
   rules) are the framework's actual invention.
3. `apps/server/test/import/revert.test.ts` beside it.
4. `docs/TESTING.md` when you need to add a test and do not know which layer it
   belongs in.
5. `docs/design/requirements-framework.md` **last**, and only if you want the
   reasoning. It is a design document, not a manual — everything you need to
   *use* the form is in steps 1–4.
