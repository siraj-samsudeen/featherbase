---
name: test-review-3-axes
description: Review a test suite against three axes — missing promise, duplicate promise, and a verdict that does not track the promise. Use when a test file feels bloated or untouchable, when deciding what survives a rewrite, when asked "do we have enough tests", "are these tests any good", "why are there so many tests", "what should we delete", or "test review using 3 axes". Treats MECE as the organising idea but partitions PROMISES, not lines of code — which is why coverage is rejected. Carries the testing-book harvest (Beck's test list, Meszaros's smells, GOOS's mocking rule, Feathers's characterization tests, property-based and metamorphic testing) and an explicit REJECT list so coverage targets, one-assertion-per-test and the strict test pyramid do not get imported by accident.
---

# test-review-3-axes

## Overview

Three axes. Not seven — an earlier draft of the origin skill had seven to mirror `code-review-8-axes`, and four of them turned out to be one defect in four costumes.

**Prerequisite, not restated here:** the three framing rules in **`code-review-8-axes`** — unknown unknowns are the binding failure mode, the owner is the binding reader, and prose cannot fail. They hold for tests unchanged, and duplicating them here would violate that skill's own Axis 3.

**The two skills chain.** `code-review-8-axes` Axis 1 finds an assumption nothing verifies. Its output *is* a missing promise — Axis 1 here. Reviewing code produces test work; reviewing tests produces code work.

Ported from the data-warehouse repo (#3666, Siraj, 16-Sep-2026). The axes and the REJECT list are that skill's; the worked examples were re-derived from this repo's suites on 18-Sep-2026.

**Read this before applying the origin skill's instincts.** That skill was written against a Python suite where mocked sinks decided more findings than the tests did. **This suite is the opposite shape**, and it changes where the yield is:

| | data-warehouse | featherbase |
|---|---|---|
| isolation | hand-built fakes, monkeypatched sinks | every test in a real Postgres transaction, rolled back (`feather-testing-postgres`) |
| test files using a double | most | **5 of 224** — `dataset-snapshot`, `sales-target`, `app-grants`, `table-lifecycle-bound`, `client-validation` |
| spec↔test linkage | none until #3691 | `tools/check-evidence.mjs`, in CI, static *and* runtime |
| pins | undeclared | `test.fails` with the issue in the title (`CLAUDE.md`'s rule) |

So Axis 3A's classic costume — *the mock satisfies it* — can only live in five files, and a review that goes hunting for it elsewhere is wasting the session. **Go to those five first; then spend the rest of the time on Axis 1.**

---

## The STC triangle — this skill is one vertex of three

| Artifact | Question | Skill |
|---|---|---|
| **Spec** | What should the system promise? | `spec-review-5-axes` |
| **Code** | Does it hold those promises? | `code-review-8-axes` |
| **Test** | Is each promise actually checked? | `test-review-3-axes` |

They drift apart continuously, whichever was written first. The edges are made greppable by **`docs/agents/stc-traceability.md`**, computed by `pnpm check:stc` (`openspec/specs`) and `pnpm check:evidence` (`docs/specs`).

**When artifacts disagree, never silently pick a winner and never punt.** Emit the divergence triage item defined in **`spec-review-5-axes`**.

---

## The one idea: MECE over promises, not over lines

MECE requires you to name the set you are partitioning. That is the whole discipline, and it is where coverage fails:

> **Coverage is MECE over lines of code.**

Which is why a coverage number tells you nothing useful — it says every line *executed*, not that any promise *holds*. Worse, it rewards the exact failure it is meant to prevent: the cheapest way to raise it is another test through a door that is already open. (This repo runs coverage ratchets. They are a **regression alarm** — "something stopped being exercised" — and the configs say so. They are not a quality target and must not be read as one.)

The other obvious candidate fails too. **Inputs cannot be collectively exhaustive** — they are infinite.

The set that *can* be MECE is the one `code-review-8-axes` already commits to:

> **The set is the promises the code makes. One test, one promise.**

And now both halves of MECE become named, distinct defects:

| | Failure | What it feels like |
|---|---|---|
| **ME** violated | several tests fail for one reason | bloat — "there are just too many"; nobody wants to touch the file |
| **CE** violated | a promise has no test | bugs escape; something always true quietly stops being true |

### Why both halves fail together — one cause, not two

> **If you derive tests from the implementation, you inherit the implementation's shape rather than the promise set.**

Walk the code and you find branches, and branches are distributed unevenly against promises. A promise implemented across five visible branches attracts five tests, each easy to write and each feeling justified — **ME violation**. A promise with no branch at all attracts zero: the things that must *never* happen, the invariants, the negative space — **CE violation**.

**So the fix is one move, not two: write the promise list first, then map the existing tests onto it.** Where a promise has three tests, delete two. Where it has none, write one.

Kent Beck's *TDD by Example* opens exactly here — before writing any code he writes **the test list**. TDD's real contribution to this skill is not red-green-refactor; it is that the list comes first.

---

## Axis 1 — Missing promise (CE gap)

**Rule.** Every promise the code makes has a test.

**The test.** *List what this module guarantees. Which guarantee has nothing pointing at it?*

**The richest source by far: every invariant currently asserted only in a comment.** Prose cannot fail, so an invariant living in prose is a promise with no test by definition. This repo's comments are unusually dense with them, which makes the harvest unusually good:

```
dataset-snapshot.ts:17  "A build that dies halfway leaves its row in 'building', which
                         activeSnapshot never resolves"                        -> TESTED
dataset-snapshot.ts:31  "Returns the row count written"                        -> untested
                         (:67 asserts the returned 8 — but the loader returns the
                         length of the array it was HANDED, and the stub hands it
                         8, so the word "written" is what nothing reaches)
sales-target-report.ts:46 "least(period_end, source_as_of) — the cutoff ACTUALLY
                         APPLIED to both sides"                                -> see Axis 3A
realtime.ts:151         "ignore malformed frames"                              -> untested
                         (nothing asserts what a non-parse failure does)
```

The first line is the positive case and shows the harvest is worth doing: *"an interrupted build is never resolved by a reader"* is a comment that became a test, and the test creates the half-built row by hand to prove it.

**Second source: the negative space.** Promises about what must *never* happen have no branch to walk, so a code-reading test author never meets them. Ask directly: *what must never happen here?* — a snapshot must never activate on a truncated fetch; a refused deletion must never move a row count; a dry run must never pass a row the real import refuses.

**Real gap — the dry run and the real path.** `document.ts:440` `checkRowForInsert` promises "the same field filtering, defaults and zod validation an insert runs". The promise is *agreement with `saveDoc`*, and it has already been broken once (#231, required children). No test runs a corpus through both paths and asserts they agree — so the next validation added to `saveDoc` silently makes the dry run over-permissive, and the symptom lands on a user mid-import.

**And the tell to look for: a safety-critical function whose every appearance in the suite is a stub.** Grep the function name across the whole suite. In this repo that grep is cheap and usually reassuring — the sandbox means most tests call the real thing — which is exactly why the exceptions matter:

```
grep -rn "_setSourceReader\|_setEmbedFetch\|vi\.fn(\|vi\.mock(\|vi\.spyOn(" apps/*/test apps/web/e2e packages/*/test
```

Five files. Everything they replace is a promise no test in that file can see.

### Property-based and metamorphic testing — the two ways out of "I can't enumerate the inputs"

When a promise holds over a space too large to enumerate, you do not write more examples. You state the property.

- **Property-based:** *"for any set of Table definitions, deletion of X is refused iff some Table Y ≠ X has a column targeting X."* This repo already writes properties into its specs in exactly that form (`docs/specs/0003-table-deletion.md`'s **Property:** lines) and proves some of them with a loop over every declared pointer column. That is the pattern to extend.
- **Metamorphic** — the answer when **no oracle exists**. You may not know what the correct output *is*, but you know **relationships** that must hold:
  - importing the same file twice with an upsert key produces the same rows (idempotency)
  - a Table's row count after a refused deletion equals the count before (stability)
  - a report's total equals the sum of its groups (decomposition)
  - creating and deleting a Table returns the database to its prior row counts everywhere except the id counter (round-trip, with the stated exception)

---

## Axis 2 — Duplicate promise (ME violation)

**Rule.** One promise, one test. Several tests that fail together for one reason are one test and some noise.

**The test has two forms. Use the one your review actually permits.**

**Read-only (the default — use this first).** Map each test to the **production predicate it exercises** — the specific line, branch or clause that decides its outcome. Two tests are duplicates when they map to the same predicate. This needs no execution and no write access.

**Executable (the confirmation, when you can run and edit).**

> **Break one line of production code. How many tests go red?**

If one bug reddens twelve tests, eleven carried no information. The rigorous version is **mutation testing** — a surviving mutant is an Axis 1 gap; a mutant that kills twenty tests at once is an Axis 2 cluster.

> **A review conducted read-only cannot run the executable form.** Do not let that stop you and do not guess: map the predicates, report the cluster, and mark it **UNVERIFIED — predicate-mapped, not mutation-confirmed**.

### In this suite, Axis 2 barely fires — and saying so is the finding

The origin skill warns about this directly: *"in a young, well-named suite Axis 1 dominates and Axis 2 barely fires; in an old accreted suite the reverse. One reviewer wasted a pass hunting deletions in a suite that was badly under-tested."*

Measured on 18-Sep-2026: 885 test declarations across 224 files, organised one-promise-per-test and named after the promise, most files under 300 lines. **Do not manufacture clusters here.** Report what is there.

**What to watch instead — the growth pattern that produces clusters later.** `apps/server/test/sources-security.test.ts` (581 lines) is organised by *provenance*: `describe('finding 1: …')`, `describe('re-review findings')`, `test('round 3: …')`. Every test in it is currently distinct — this is **not** a finding today. It is the visible signature of the REJECTed rule *"every bug gets a regression test"*, which appends a test per incident with no check against the promise set. The moment two review rounds raise the same underlying promise, that file gets its first genuine duplicate and nothing will notice. The cheap prophylactic is to name tests after the promise and let the issue number ride in a comment — which 870 of the 885 already do.

### The critical nuance: many CASES is not many TESTS

A parametrised sweep — one promise, twenty inputs — is **one test**, and it is the *cure* for Axis 2, not an instance of it. Twenty separate functions asserting the same thing would be the violation.

The mechanical rule, which beats arguing about intent: **the sweep is earned when different cases kill different mutants.** If every case dies to the same mutation, the extra cases are padding. Measured, not judged.

---

## Axis 3 — The verdict does not track the promise

**Rule.** A test must go red when the promise breaks, and stay green when it holds. Two directions, one defect.

**The test.** *What would make this fail? What would make it pass?* If either answer is anything other than "the promise", you have found it.

### Direction A — passes when the promise is broken (false confidence)

Four costumes, one defect. The assertion is satisfied by something other than the system being right: the **mock** satisfies it; the code's **own output** satisfies it (a value copied from a previous run — a pin, not a proof); a **stale fixture** satisfies it; or **anything** satisfies it (tautologies, `expect(mock).toHaveBeenCalled()`).

**Real violation — the double makes the production disagreement impossible.** `apps/server/test/dataset-snapshot.test.ts:43`:

```ts
function stub(rows, asOf = '2026-09-17') {
  _setSourceReader(async (text) =>
    /max\(actuals_as_of_date\)/.test(text) && !/with cutoff/.test(text) ? [[asOf]] : rows)
}
```

The double dispatches on SQL text: the as-of query gets one constant, the rows query gets the rows. In production those are **two statements over two connections at two moments** (`motherduckReader` builds a fresh `DuckDBInstance` per call), and a third read of the same fact lives inside the rows query's own `cutoff` CTE.

So the freshness test —

```ts
expect(r.source_as_of).toBe('2026-09-15')
expect(r.data_through).toBe('2026-09-15')   // "the cutoff actually applied to both sides"
```

— passes **because one constant answered every read**. The promise it asserts is that the displayed as-of and the cutoff applied to the rows are the same fact; the harness guarantees that by construction and production does not. Worse, the double cannot apply a cutoff at all: it returns the same rows whatever bound the SQL carries, so no test in this file can distinguish "the cutoff was applied to the rows" from "the cutoff was only reported".

> **The mock inherited the assumption.** A test suite cannot catch a disagreement its own harness makes impossible. This is the same shape as the origin repo's #2418, in a codebase with no such history — which is why it is worth stating as a rule and not as a war story: **when a double answers two production calls from one value, ask what could have made those two values differ.**

**Fix shape** — make the double capable of disagreeing: let `stub()` take the as-of and the cutoff separately, and add a case where they differ. That single case is what converts the assertion from decoration into a verdict.

**Real violation, narrower — an absence proved by one spelling.** The same file's best test asserts the personalisation predicate is absent from the generated SQL:

```ts
expect(s).not.toMatch(/plant_code\s*=\s*'/)
expect(s).not.toMatch(/hierarchy_code\s+in\s*\(/)
```

Its comment is right that *"a comment cannot enforce this; this can"* — and the test is worth keeping. But what it proves is the absence of **two spellings**. Re-introduce the scope as a bound parameter (`plant_code = $1`), or as a join, or as `plant_code in (…)`, and the test stays green while the property it defends is gone. A negative assertion over generated text is only ever as strong as its enumeration of spellings — say so in the test, or assert the property positively (build the SQL for two different readers and assert the strings are identical).

**Two more shapes to grep for in this repo:**

- **A teardown that cannot fail.** `.catch(() => {})` appears 22 times in `apps/server/test`, mostly as `await uninstallApp(APP).catch(() => {})`. With `fileParallelism: false` and one shared database, a silently failed uninstall leaks state into the next file, where the failure surfaces as something unrelated. The cleanup is not the promise — but a cleanup that cannot fail is how one file's bug becomes another file's mystery.
- **A test whose only assertion is that its own injected error came back.** Read every test beside its siblings: **a test missing the assertion its neighbours all make is the highest-yield signal in this whole skill.**

**The rule that prevents Direction A** (Freeman & Pryce, *GOOS*): **only mock types you own.** Never fake MotherDuck, the OAuth provider or the filesystem directly. Wrap them in an interface *you* define, whose contract you can state and verify separately, and fake that. `_setSourceReader` is exactly that shape, correctly done — the finding above is about what the fake *does*, not that it exists.

**The honest use of a pin** (Feathers): a test that asserts what the code currently does, when nobody can derive what it *should* do, is a legitimate and valuable tool — a **characterization test**. The defect is never pinning; it is pinning *silently*. This repo already holds the rule and enforces it: `CLAUDE.md` requires `test.fails` with the issue number in the title, and `check-evidence.mjs` refuses to let a `pinned #N` verdict be satisfied by anything but an executable expected-failure naming that issue. `apps/server/test/table-lifecycle.test.ts:130` is the worked example — *"renaming a column keeps its data readable under the new name (pins #250)"*. **Do not "fix" a pin by deleting it; fixing the defect flips it to a plain test in the same change.**

### Direction B — fails when the promise holds (false alarm)

The test is pinned to an internal detail, so a behaviour-preserving refactor reddens it. Meszaros calls this a **Fragile Test**; a flaky one he calls an **Erratic Test**, and it is the same defect with a random trigger.

**The test.** *Rename a private helper, or restructure a function without changing behaviour. Does this test care?* It should not.

**Where to look here:** assertions over generated SQL text (`definitionSql`), assertions over exact error strings, and e2e locators tied to DOM structure rather than `data-testid`. This repo is largely clean on the third — `table-deletion.spec.ts` asserts `[data-testid="delete-table"]`, not a CSS path — which is the discipline to preserve.

**The rule, stated by this repo's own counter-example** (`docs/specs/0003-table-deletion.md`'s J1 walk): assert **decisions** — status, body, what the user can observe — never a call into internals, so a rewrite cannot satisfy the test by keeping a function name.

This is where "too many tests" stops being a cost and becomes **harm**. A suite that reddens on every refactor teaches everyone — humans and agents alike — not to improve the code.

---

## How to run a review

**1. Write the promise list first.** Before reading a single test, list what the module guarantees. This is Beck's test list.

**Start from the spec where one exists.** `docs/specs/*.md` is a governed promise list — journeys, rules, invariants, hazards, each with an ID — and `openspec/specs/**` is the same in capability form. Take those first, **then** extend from doc comments and the negative space (*what must never happen?*) — and **report what you had to add.**

That delta is a deliverable: **every promise you had to invent is a spec gap**, and it goes back to the spec. Where a spec obligation and the code disagree, that is not yours to settle — emit the divergence triage item from `spec-review-5-axes`. This repo states the same rule as a hard rule: *"A discovered behaviour is not a requirement … choosing is the owner's call, never an agent's."*

Two things the list needs to be useful:

- **Granularity: one promise per predicate or branch-of-decision, not per function.**
- **The list is fallible, and step 3 feeds back into it.** A test that maps to nothing may be a duplicate, a test of the implementation — or evidence your list was incomplete. Take the third reading seriously.

**2. Review the doubles before the tests.** For every fake, stub and injection: *what production behaviour does this replace, and what argument or side-effect does it discard?* In this repo that is five files and it is the highest-yield hour of the review.

**3. Map the existing tests onto the promise list.** `pnpm check:stc` and `pnpm check:evidence` give you the declared edges for free; the mapping is the part they cannot do.

**4. Mutate. This is the verification step for all three axes**, not an optional extra for Axis 2.

Never edit the working tree while reviewing. Use a throwaway worktree:

```bash
git worktree add /tmp/mutate HEAD && cd /tmp/mutate && pnpm install --frozen-lockfile
# edit ONE line, then run only the file that should care:
pnpm --filter server test -- test/dataset-snapshot.test.ts
git -C /home/user/featherbase status --porcelain        # prove you touched nothing
```

Read the result by axis:

| Mutation | Verdict | Axis |
|---|---|---|
| changes behaviour, **survives** | no test defends this promise | **1** |
| changes behaviour, survives, but a test *claims* the promise by name | the test lies | **3A** |
| **preserves** behaviour, **reddens** | the test pins an implementation detail | **3B** |
| one mutation reddens many tests | those tests share one reason to fail | **2** |

> **3A is a surviving behaviour-changing mutant; 3B is a killed behaviour-preserving mutant. Same instrument, opposite verdict.**

**A surviving mutant is a hypothesis, not a finding.** Confirm the mutation actually changed behaviour — an *equivalent mutant* looks identical from outside.

**5. Axis 1 vs Axis 3A — the boundary rule.**

> **Axis 1 when no test claims the promise. Axis 3A when a test claims it — by name, by comment, or by sibling convention — and does not check it.**

The loader's row count is claimed by nobody → Axis 1. `'a snapshot read states the source as-of, not the build time'` claims the freshness promise in its own name → Axis 3A.

**6. Axis 2 — do not manufacture findings.** See the measurement above. Report what is there.

**7. Confirm the suite actually runs, and gates something.** Find the CI job. In this repo: `.github/workflows/test.yml` runs the unit/component suites with coverage, the e2e suite, and both evidence passes. `pnpm check:stc` is **not** wired in yet, and `pnpm smoke`'s server half runs nowhere in CI. State that at the top of the review, not the bottom.

**8. Do not edit tests while reviewing.** Findings and fixes are separate acts and separate PRs.

### Output format

Lead with the promise list — it is the most valuable artifact the review produces, and it outlives the findings. Then, per finding:

```
[VERIFIED] Axis 3A — passes when the promise is broken
  apps/server/test/dataset-snapshot.test.ts:43
  `stub()` answers the as-of query and the rows query from ONE constant, so the
  two-reads-two-moments disagreement that production allows cannot occur under
  test. The freshness test asserts source_as_of === data_through — "the cutoff
  actually applied" — and the harness guarantees it.
  Failure: a mart that advances mid-build ships a report whose stated as-of is
  not the cutoff its rows were cut at, and no test can go red.
  Fix shape: give stub() separate asOf and cutoff values; add the case where
  they differ.
```

Close with: a count of **findings** per axis and, separately, **promises tested vs total** (they measure different things); the single best deletion candidate; the single most dangerous gap; and a **refuted list** — every suspicion you investigated and dropped. The refuted list is not filler.

---

## The REJECT list

| Rejected | Why |
|---|---|
| **Coverage targets** | MECE over the wrong set — lines, not promises. Rejected because it partitions the wrong thing, not because measuring is wrong. The ratchets in this repo's vitest configs are regression alarms; do not turn them into goals. |
| **"Every bug gets a regression test"** | The main engine of Axis 2. It appends a test per incident with no check against the promise set. See the correct version below. |
| **One assertion per test** | Meszaros's *Assertion Roulette* is about assertions you cannot tell apart on failure, not about their number. Several assertions about **one promise** is correct. |
| **The strict test pyramid** (many unit, few integration) | Wrong shape for this product. The risk lives in metadata-driven generation, permissions and SQL — so integration-level tests against a real Postgres carry most of the value. That is what the sandbox is *for*; over-applying the pyramid here would manufacture Axis 3A at scale. |
| **Mock everything / total isolation** | Produces Axis 3A at scale. GOOS's rule stands: only mock types you own. |
| **Test count or test-to-code ratio as a quality signal** | 17,326 lines of server test says nothing about whether the promises are covered. Count promises, not tests. |

### What a bug actually means

Replaces "every bug gets a regression test". **A bug is evidence the promise list was wrong.** Three repairs follow, and choosing correctly is the discipline:

- The promise was **missing** → add it to the list, and write the test. *(Only this case adds a test.)*
- The promise was **stated but not executable** → it existed as prose. A comment saying "the cutoff actually applied to both sides" is a perfectly clear promise written as a **document instead of a test**. That is the reflex to break.
- The promise was **wrong** → the code was right and the spec was stale. Edit the promise and **delete** the test enforcing the old one — which, in this repo, means taking it to the owner first.

---

## The owner's standing rules

From Siraj (via the origin repo, 16-Sep-2026):

- **Too many tests is a real defect, not fussiness.** It is specifically an ME violation and it has a mechanical test.
- **Hardcoded tests that give nothing but headaches should be eliminated.** A pin that does not say it is a pin is the target; a named `test.fails` pin is not.
- **Do not manufacture axes for symmetry.** Three is the honest number.
- **Pure aesthetics do not matter.** A finding that cannot be stated as a concrete failure is not a finding.

And this repo's own, which bind a reviewer directly: **no expectation laundering** — never weaken an assertion to obtain a passing run; **nothing is `done` on an agent's word** — record the command, not the verdict.

---

## What is deliberately NOT a separate axis

An earlier draft had seven. These merged, and the reasoning is kept so they are not re-split:

- *proves the fake* + *unjustified oracle* + *cannot fail* + *stale fixture* → **Axis 3A**. All four mean the test passes for a reason other than the promise holding.
- *pinned to the implementation* → **Axis 3B**. The mirror of the same defect.
- *flaky* → Axis 3B with a random trigger.
- *slow* → a note, not a design defect.
- *test names that do not state the promise* → a symptom of having no promise list, addressed by step 1. This repo already does this well — do not "fix" it.

Kept at three rather than two because **a false-tracking test is worse than a missing one**: missing means you know you do not know; false means you think you know.

---

## Provenance

| Idea | Source |
|---|---|
| The **test list** comes before the code — the promise set | Kent Beck, *TDD by Example* |
| Fragile Test, Erratic Test, Assertion Roulette, Obscure Test | Gerard Meszaros, *xUnit Test Patterns* |
| **Only mock types you own**; listen to the tests | Freeman & Pryce, *Growing Object-Oriented Software Guided by Tests* |
| **Characterization test** — the honest name for a pin | Michael Feathers, *Working Effectively with Legacy Code* |
| Properties instead of examples | John Hughes, QuickCheck |
| Metamorphic relations where no oracle exists | metamorphic testing literature (Chen et al.) |
| MECE as the organising frame | Siraj's consulting practice, applied to promises rather than lines |
| Framing rules, and the promise as the unit | `code-review-8-axes` |
| The sandbox model this suite is built on | Phoenix / Ecto SQL Sandbox, via `feather-testing-postgres` |

Evidence base, re-measured on 19-Sep-2026 at `3a6770f`, with the command that
produces each number rather than the number alone — a hand-kept tally goes stale
silently, which is the failure this repo's `CLAUDE.md` names:

```bash
# test files
find apps packages -path '*/node_modules' -prune -o \
  \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print | wc -l
# 224
# test declarations
grep -rhoE '^[[:space:]]*(test|it)(\.[a-z]+)?\(' apps packages \
  --include=*.test.ts --include=*.test.tsx --include=*.spec.ts --include=*.spec.tsx | wc -l
# 1176 — 792 server, 130 web unit, 177 e2e, 77 shared
```

The five files carrying a double were read in full; `dataset-snapshot.test.ts`'s `stub()` is the verified Axis 3A example.
