# Featherbase Requirements — Journeys, Rules, and Shapes

**Status:** v2 — synthesis draft, featherbase-local · **Written:** 2026-08-03
**Sources merged:** the journeys/rules draft (v1, this file's history) · the
external review ("requirements that survive contact with agents") · the
owner's feather-spec framework (`feather-skills/skills/feather-spec`)
**Worked example:** Spreadsheet Import (Part II)
**Standing:** local convention, to be tested and iterated here first.
feather-spec (the skill) inherits this only after it survives 2–3 real
features — see Part III §6.

---

# Part I — The framework

## 1. What a requirement carries

Strip the syntax off any requirements format and it is trying to carry five
things:

1. **Why** — what job the user is hiring this feature for.
2. **Where and what** — the world: screens, entities, and one concrete
   dataset everyone reasons about.
3. **Behaviour** — in some state, when the user acts, what must observably
   happen.
4. **Boundaries** — where behaviour bends: errors, edge cases, limits.
5. **Proof** — how we would know any of it is true.

Two structural claims organize everything below. They answer different
questions and compose.

**Claim 1 — the document reads at two altitudes.** Humans think in
*journeys* (the walk through the feature, told once, in order) and verify
with *rules* (the decisions the system makes along the walk). Every classic
format fails by picking one altitude: QA scripts are all journey and no why;
EARS lists are all rule and no walk; Gherkin lives in the middle and
dissolves into scenario soup. The document needs both altitudes explicitly.

**Claim 2 — proof sorts by shape, not mechanism.** The test pyramid sorts
tests by how they are wired (unit / integration / e2e). That answers
nothing. Sort instead by **the shape of the thing under test**, because the
shape determines the *oracle* — how a test knows the right answer:

| Shape | What it is | Oracle | Native idiom | In Spreadsheet Import |
|---|---|---|---|---|
| **Rule** | Pure function over an unbounded input space | Derivable | Property tests + boundary enumeration, example tables for agreement | Header sanitization, type inference |
| **Sequence** | Ordered interaction where state accumulates | Observable | Browser walkthrough | The wizard journeys J1–J3 |
| **Contract** | A boundary with consumers on both sides | Specified | API tests | `POST /api/table/:t:import` — the wizard is not its only consumer |
| **Invariant** | A relationship holding across a whole run | Arithmetic | Reconciliation assertions | rows in file = inserted + failed + dropped |
| **Judgement** | A heuristic whose right answer is an opinion | **None** | Labelled corpus scored as %, consistency assertions | Choice promotion, target matching |

Every rule carries a shape tag naming its **primary verification
strategy**. The shapes overlap at the edges (an invariant is a kind of
rule; a contract contains sequences) — the tag is routing advice for which
evidence to reach for first, not an exclusive taxonomy, and an obligation
may need supporting strategies beside its primary one.

> **Why this is not academic.** Applying the shapes lens to this one feature
> surfaced eight defects in code whose every inventory entry reads
> `passing`. Three were re-confirmed by direct execution while writing this
> document (Part II, coverage matrix). None is a sequence defect; browser
> tests are an inefficient, incomplete way to explore these input spaces —
> property and boundary tests are the right primary evidence.

## 2. The sorting criterion

Three sources derived this rule independently — feather-spec §9 ("H4
scenario when the code path differs, example-table row when only values
differ"), this document's v1 ("path variation vs data variation"), and the
external review ("a deviation earns a browser test only if what differs is
a screen, element, or transition"). Triple convergence; adopted without
reservation:

- **Data variation** — the walk is identical, only values differ → **a row
  in a rule's example table**, proven at the rule layer. Cheap; add dozens.
- **Path variation** — the walk itself forks: a different screen, an
  interruption, another route → **a branch step or short variant journey**,
  proven by a browser. Expensive; add few, deliberately.
- **Undecided** — nobody has agreed what should happen → **an open question
  with a named arbiter**. Never invented to make the document look complete,
  never resolved silently in code.

### Closure — what the sorting rule alone doesn't reach

Data/path/undecided sorts the edge cases you already thought of. Before a
spec is called done, sweep the lenses the walk doesn't surface and write
an ID or a justified `N/A` for each — one line apiece, no table required:
actors & permissions · prior state & lifecycle (incl. reversal) ·
concurrency & retries · external-dependency failure · durability &
recovery · security & privacy · accessibility · performance & scale ·
observability · compound hazards. feather-spec's cue-driven sections
already carry half of these; an explicit `(none — reason)` is a meaningful
answer, silence is not.

## 3. Examples are for agreement; properties are for coverage

The v1 draft claimed a rule's example table, copied literally into a unit
test, was the rule's proof. **That claim is refuted by evidence.** Three
defects sat in functions whose example-based tests were green, because a
finite example list cannot constrain an unbounded input space — and worse,
a passing example set produces the *feeling* of coverage without the fact
of it. (`sanitizeHeaders` had every branch covered and still returned three
identical names for three identical long headers.)

So every rule-shaped rule carries **both**, with different jobs:

- **The example table** is the negotiation instrument — five concrete rows
  settle what prose cannot; the business signs it; the "Why?" column
  explains intent; `rejected` is the sentinel for refusals; any cell that
  needs more than one line promotes to its own scenario (feather-spec §9,
  adopted verbatim).
- **The property** is the coverage instrument — one sentence quantified over
  the whole input space (*"outputs are always valid, unique, and ≤63
  chars"*), enforced by a property test plus enumerated boundaries.

**Disagreement blocks, it never tiebreaks:** when a rule's statement, an
example, and a property disagree, the requirement itself is inconsistent
and implementation of that behaviour is blocked. The decision owner rules
on which representation is wrong (or whether the example is a legitimate
exception), and statement, examples, and property are updated **together
in the same change**. An example stays the preferred negotiation
instrument without becoming an automatic winner.

## 4. Judgement has no oracle

"Should a nine-value Status column become a Choice?" has no correct answer,
only a defensible one. The thresholds inside such heuristics are **bets,
not facts**, and a bet cannot pass or fail a test. What you can do:

1. **Score it against a labelled corpus** — representative files with agreed
   expected outcomes, reported as a percentage, never pass/fail.
2. **Assert consistency, not correctness** — same input, same answer;
   permuting rows changes nothing.
3. **Re-score on change** — altering a threshold reports the delta across
   the whole corpus, not one reviewer's verdict.

A judgement is not oracle-free so much as split-oracle: **conformance**
(the code implements the approved algorithm and named constants — a
deterministic oracle) is separate from **fitness** (the heuristic is
useful — an empirical, corpus-scored oracle). Test the first normally;
score the second.

Two honesty requirements. First, every threshold is a **named constant**
recorded in one small ADR — spec and code reference the name, never the
literal. Second, this product has no users yet, so any corpus is synthetic:
its edge cases are *imagined*, not *encountered*. Name that substitution
and treat the corpus as a debt to real user files, not an authority.

## 5. Negative space and assertion polarity

Four kinds of "must not", and a mechanical rule for which are testable:

- **Absent affordance** (no undo control) — the missing thing *would have a
  selector* → gets an absence assertion.
- **Absent side effect** (a rehearsal writes no history row) → asserted
  through the contract.
- **Absent data change** (a refused import leaves no partial rows) →
  asserted through an invariant.
- **Absent quality** ("the message must not be confusing") — no selector →
  **no test**; an explicit `unverifiable` status with a named human method.

Two disciplines make absence assertions safe:

- **Assert the positive complement.** `expect(x).toHaveCount(0)` is also
  true when the page failed to render. Assert "the action bar contains
  exactly [Import]", not the absence alone.
- **Tag polarity — and pins assert the SPEC, expected-failing.** A pin is
  an `it.fails`/`test.fail` whose assertion states the intended behaviour;
  it goes green only because the failure is expected, and fixing the
  defect flips it loudly. A **passing** assertion of the wrong behaviour
  is never a pin — it teaches agents the defect is the contract. Where an
  expected-failing test is impractical (persistent data), weaken to a
  neutral assertion and record the row as `known-gap` with no evidence
  claim.
  They look identical in a test file and mean opposite things — untagged, a
  future agent reads a gap-pin as the specification and "fixes" the test by
  preserving the bug. And scope the pin correctly: this feature's Check
  button gap-pin guards a whole-*file* predicate while the behaviour is
  per-sheet, so in a mixed workbook the assertion is simply false. A wrong
  pin is worse than none.

## 6. The document's layers

**Journey** — one narrative walk, told once, in human order; two or three
per feature. Each step is the triple *(where am I, what do I do, what must
I observably see)*. Every "see" is an observable — visible text, an enabled
control, a row in a list — never an internal state. That discipline is what
gives the test a regular structure: where = locator, do = action, see =
assertion; one journey ⇒ one browser test whose skeleton follows the steps
in order — the author still owns setup, isolation, waits, and adequacy
(the first journey spec proved exactly this: the landing path and the
used-database branch were authoring decisions, not translations).
Two sequence caveats named honestly: a repeating stage (per-sheet cards) is
a *loop with cardinality*, not extra steps; and durable intermediate states
(partially imported, unrecoverable) are first-class named states, not
edges.

> **The generation target is the feather-testing DSL, not raw Playwright.**
> [`feather-testing-core`](https://github.com/siraj-samsudeen/feather-testing-core)
> (published, 0.2.0) speaks the step triple natively — `visit`/`within` are
> *where*, `clickButton`/`fillIn`/`selectOption`/`upload`/`dropFile` are
> *do*, `assertText`/`assertHas`/`refuteHas` plus the form-state family
> (`assertValue`, `assertChecked`/`refuteChecked`, `assertSelected`,
> `assertOptions`) are *see* — so a journey compiles to one fluent chain
> instead of locator soup:
>
> ```ts
> test('IMP-J1: first import creates a typed Table', async ({ session }) => {
>   await session                                        // J1.1
>     .visit('/')
>     .clickLink('Import Data')
>     .assertHas('[data-testid="drop-area"]');
>   await session
>     .dropFile('[data-testid="drop-area"]', 'fixtures/zones.csv') // J1.2
>     .assertText('8 rows, 6 columns')
>     .assertValue('Table name', 'Zones')                // J1.3
>     .clickButton('Import 8 rows')                      // J1.6
>     .assertText('Hotel');                              // J1.7
>   await session
>     .clickLink('Alpha')                                // J1.8 — typed, not text
>     .assertSelected('Region', 'North')
>     .assertOptions('Region', ['North', 'South'])
>     .assertChecked('Is Active');
> });
> ```
>
> Three properties make it more than sugar. Its `StepError` prints the
> whole chain with `[ok] / [FAILED] / [skipped]` markers — the journey walk
> with a failure position, i.e. **positional step traceability for free**,
> complementing the rule IDs in test titles; since 0.2.0 the session keeps
> an executed-step history, so a journey split across several `await`s (as
> above) still prints the *full* walk, and each queued step is wrapped in
> Playwright's `test.step()`, so the walk appears step-by-step in the trace
> viewer. Its `refuteText`/`refuteHas` are the absence-assertion vocabulary
> of §5 (the positive-complement rule still applies — pair a refute with an
> `assertHas` count — and is now documented in the DSL's own README). And
> the same vocabulary has an RTL adapter, so a sequence can be exercised at
> the integration tier without rewriting — a cheaper path for promoting
> "never witnessed in a browser" matrix rows. The verbs this document
> originally flagged as missing shipped upstream in 0.2.0 — `upload(label,
> path)` for file inputs, `dropFile(selector, path)` for drop areas, and
> the form-state assertion family, making J1.3 and J1.8 fully expressible.
> Any verb still missing has an escape hatch: `step(name, fn)` queues a
> named custom step (the callback receives `{ page, scope }`) without
> abandoning the chain. The standing policy held — **contributed upstream
> and released, never patched locally** (the `feather-testing-postgres`
> policy).

**Rule** — the why behind an expected value, tagged with its shape. Rules,
not steps, carry IDs, because rules outlive UI redesigns. Rule-shaped rules
carry example table + property (§3); judgement-shaped carry named
thresholds + corpus pointer (§4); contracts enumerate every documented
behaviour and error; invariants state the arithmetic.

**Hazards** — a short register of compound risks that belong to no single
step or rule ("cannot stop AND cannot undo AND re-import duplicates").
The worst defects are properties of features held together; without a
register, no row owns them and no review sees them.

**Open questions** — each with a named arbiter and its blockers. When
answered, the answer graduates into a rule or step and the question is
removed (feather-spec's protocol).

**Coverage matrix** — the only overlay, never woven into the spec body.
Rows are journeys, rules, invariants, hazards, questions; columns are
shape, proof (tier + file), and verdict. Three integrity mechanisms:
**the test title is the join key** (a test named `IMP-R1: …` links itself;
CI failures name the requirement at risk) — this is **static
traceability**, a claim of linkage, never execution evidence: whether the
test ran, passed, or skipped is stamped separately; **staleness stamps** (the matrix
states the commit it was verified against — an unstamped row is a
hypothesis. There is **no
automatic precedence between artifacts** — approved requirements and
decisions define intended behaviour; code is the current implementation;
tests are verification claims; execution results are evidence; an observed
undocumented behaviour is a finding. When artifacts disagree, an agent
classifies the discrepancy — implementation defect, incorrect test, stale
requirement, unresolved product decision, or environmental failure — and
never lets code or tests silently overrule approved intent); and **skip ≠ pass** (every
journey test states its isolation strategy; a skipped test reports as
distinct from a passing one — this feature's golden-path e2e currently
skips itself on any database that has run it once, and reads green).

## 7. Lenses, not seats

The review enumerated eight stakeholder roles and the instinct to give each
a seat produces a committee. feather-spec's **lens-per-artifact** model
(§5.0) is the better resolution and is adopted: every artifact serves one
audience and one perspective; when content could serve two, the primary
motivation wins and the other gets a cross-link. Roles become *reading
paths* over the same document:

| Reader | Reads | Gets |
|---|---|---|
| **Business owner** | Job, fixture, journeys (skipping branches), example tables | Sign-off in minutes, in their own vocabulary |
| **Product manager** | Journey list, open questions, hazards, matrix | What's undecided and who owes the answer; proven vs claimed |
| **Developer** | Rules with shapes, contracts, invariants | Unambiguous decisions; which test layer proves each |
| **Author agent** | Rules + journeys + fixture | What to build and where the new test goes |
| **Reviewer agent** | Negative space, polarity tags, hazards | A statement of what must *not* be true — independent of the author's tests. An agent judging its own tests passes them; the reviewer needs the opposite document, which is the structural argument for keeping spec and tests separate |
| **QA / test architect** | Shape tags, coverage policy, matrix | Whether the suite proves anything — adequacy, not counts |
| **Domain SME** | Judgement rules, thresholds, corpus | The bets nobody else can make |
| **Decision owner** | Open questions naming them | Resolution — the one contribution that unblocks everything else |

Rejected as standing seats, kept as fields or gates: technical writer,
release manager, migration, compliance (fields on a requirement; a trigger,
not a review), security (a scoped gate at file parsing and permissions).

## 8. IDs and traceability

- **Emergent, then immutable.** An ID exists when something outside the
  document cites it (a test, a workflow, another feature) — feather-spec's
  principle. Journeys and rules are born cited (tests quote them), so they
  get IDs at authoring: `IMP-J1`, `IMP-R3`, invariants `IMP-I1`, hazards
  `IMP-H1`, questions `Q1`. Steps stay positional (`IMP-J1.4`). When one
  clause of a grouped rule needs independent citation — a test, an issue —
  it gets a stable sub-ID at that moment (`IMP-R2.7` is the precedent);
  groups are never pre-exploded into atomic IDs nobody cites. Once born,
  an ID is never renumbered or reused; a retired one is tombstoned with a
  `superseded-by` pointer.
- **Tests quote the spec, never the reverse.** A discovered behaviour is not
  a requirement — it has three fates (ratified, filed as a defect, raised as
  an open question) and choosing is a human act.
- **Derive, don't maintain.** Every trace link comes from an artifact that
  already has to be correct: test titles, the generated matrix, git diffs.
  Hand-maintained sidecars rot.

## 9. What "coverage" may honestly mean

"100%" names four incompatible targets (requirements, statements, branches,
journeys). The demonstration that settles the policy: `sanitizeHeaders` had
100% branch coverage directly over a real data-loss defect. **Branch
coverage measures what tests touched; it cannot measure what they
concluded.** The policy:

> **Every requirement maps to a named verification method — including the
> methods that are human.**

| Shape | Target | Measured by |
|---|---|---|
| Rules | Properties + boundary enumeration | Mutation testing, scoped to rule code, surviving mutants reported — never a universal headline |
| Sequences | Golden path + deliberate branches | Browser, budgeted by wall-clock, not count |
| Contracts | Every documented behaviour + every error | API tests |
| Invariants | Reconciliation across a full run | Arithmetic assertions |
| Judgement | Corpus score | Percentage, human-labelled |
| Unverifiable | Named human method + cadence | Explicitly not automated |

Requirement-mapping stays as a CI *gate* (it catches forgetting, which is
common and cheap to detect) but is **never published as a percentage** —
that is the number that gets gamed. A 100%-coverage mandate reliably buys
tests that assert nothing, requirements split to inflate the denominator,
and a flaky suite nobody reads — and flakiness destroys trust faster than
missing coverage does.

## 10. Agent protocol

Two rules, destined for `CLAUDE.md` on adoption (they are useless in a
document agents don't read):

1. **An agent may never modify an assertion and the code under test in the
   same change.** One or the other; the pairing is how defects get ratified.
2. **A discovered behaviour is not a requirement** (§8). Ratify, file, or
   raise — a human chooses.

## 11. What this format deliberately omits

- **Implementation detail** — no API routes, schemas, or component names in
  the spec body; those live in code, `design.md`, and ADRs (feather-spec's
  product-vs-tech lens).
- **Status woven into the spec body** — the spec says what *should* be
  true; the matrix says what *is proven*, stamped with when.
- **Hand-written "actual" columns** — actual is the test run's output.
- **Restatements** — the journey is told once; everything else is a delta.
- **Committee seats and published percentages** — §7 and §9.

## 12. The product manual is a view, not a second document

A user manual and a journey spec describe the same thing — the walk — so
the manual is **generated from the journey layer**, never authored twice.
Each step's *do* becomes the instruction, its *see* becomes the caption,
and a **screenshot slot keyed by the step ID**
(`docs/manual/shots/IMP-J1.4.png`) holds the picture. The slot contract is
what makes one document serve the whole lifecycle:

- **Before anything is built**, a slot renders its fallback — the ASCII
  zone diagram or a mockup crop — straight from the spec. The manual
  exists on day one, honestly labelled as a sketch.
- **Once the journey's DSL test exists**, running it with `SNAP=1`
  captures a screenshot at each step boundary into the slot path,
  overwriting the fallback. **The document never changes; its assets
  mature** — sketch → mockup → real pixels, all at the same address.
- **Freshness is derived, not maintained.** Screenshots are produced only
  by a passing journey test, so a missing or stale shot means the walk has
  not been proven on this commit — the same staleness discipline as the
  matrix (§6). Shots are committed, so a PR that changes the UI shows
  screenshot diffs next to code diffs: change-impact for the eyes.

Both standing rules survive intact. The direction rule (§8): test runs
supply *assets only* — prose flows spec → manual, never test → spec. The
lens rule (§7): the manual is the **end-user lens** rendered from the
journeys — imperative voice, no rule IDs, no gaps, no matrix — while the
spec keeps its other audiences.

Caveats priced in up front: fixed viewport and theme per snap; dynamic
values masked or seeded (row ids come from a global counter — R6's "verify
the shape, never the value" applies to pixels too); snap on demand rather
than on every CI run, so visual noise never makes the suite flaky. The
capture verb (`snap(slotId)`, or auto-snap at step boundaries under
`SNAP=1`) belongs upstream in `feather-testing-core`, same policy as the
other verbs. Until it ships, 0.2.0's `step(name, fn)` escape hatch can
host an interim capture (`step('snap IMP-J1.4', ({ page }) =>
page.screenshot(...))`) without leaving the chain.

Exemplar: [`docs/manual/spreadsheet-import.md`](../manual/spreadsheet-import.md)
— hand-rendered once to fix the target output; the generator that derives
it from the spec's journey tables is adoption work, built only after the
format survives review.

---

# Part II — Worked example: Spreadsheet Import

## The jobs

**IMP-J1 — "I have a spreadsheet and no table yet."** The file becomes a
new Table, correctly typed, and fills it. The first-time user's journey.

**IMP-J2 — "The table exists and I have more rows."** The file's columns
map onto an existing Table and the rows are appended.

## The fixture — `zones.csv`

Eight rows, six columns, designed so every column lands on a different
inferred type without a judgement call:

| Zone Name | Region | Population | Area Sq Km | Opened On | Is Active |
|---|---|---|---|---|---|
| Alpha | North | 12000 | 45.5 | 2026-01-15 | yes |
| Bravo | South | 8400 | 12.25 | 2026-01-16 | no |
| Charlie | North | 23100 | 88.0 | 2026-01-17 | yes |
| Delta | South | 5600 | 7.75 | 2026-01-18 | no |
| Echo | North | 17200 | 33.5 | 2026-01-19 | yes |
| Foxtrot | South | 9900 | 21.0 | 2026-01-20 | no |
| Golf | North | 14500 | 52.25 | 2026-01-21 | yes |
| Hotel | South | 6300 | 18.5 | 2026-01-22 | no |

*Zone Name* vs *Region* is the point: both plain text, separated only by
repetition (→ R3). *Is Active* is the ordering trap: it clears the Choice
bar exactly as Region does and stays a tick box only because the yes/no
test runs first (→ R2.7).

**The fixture's limits, stated on purpose:** zones.csv is deliberately
benign — it is the *agreement* instrument. It contains no leading-zero
codes, no 16-digit identifiers, no 70-character headers, which is exactly
why example-driven tests over it stayed green across three real defects.
Coverage of the hostile space lives in the rules' properties and
boundaries, not in this file.

## IMP-J1 — First import: file to new Table

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J1.1 | Anywhere — click **Import Data** in the sidebar | The import screen with an empty drop area | |
| J1.2 | Drop `zones.csv` | The file name, *1 sheet*, one card reading *8 rows, 6 columns* — counts describe the **file**, never a Table | |
| J1.3 | Read the target, change nothing | *Import into* reads **New Table…**, name prefilled **Zones**; nothing suggests appending | R5, R7 |
| J1.4 | Read the column grid | Six editable column rows matching R1–R4 exactly, plus a locked **Row ID** row | R1–R4 |
| J1.5 | Read the Row ID row | A readable series from the Table name, previewing `ZONES-###` | R6 |
| J1.6 | Click **Import 8 rows** | The button counted the file's rows *before* the click; progress, then completion | R8, C1 |
| J1.7 | Wait | The **Zones** list: all eight, Alpha through Hotel; ids match `ZONES-` + digits | R6 |
| J1.8 | Open any row | Typed values, not text: Region a select offering exactly North and South; Is Active a real yes/no control; Opened On still 2026-01-15 | R2, R3 |
| J1.9 | Open the import history | One entry: Zones, `zones.csv`, 8 inserted, 0 failed, Table created by this import | R10, I2 |

**Branch at J1.2 — wrong file kind.** Drop `notes.pdf`: refused by name —
*notes.pdf: not a CSV or Excel file* — screen otherwise unchanged.

**Branch at J1.6 — a bad cell.** Applies once the column's type is fixed —
appending to an existing Int column (J2), or after the user set Int by
hand: a cell reading `abc` fails that row, the others import, and the
failure is reported by its **true spreadsheet row number** (→ I1; volume
limits → Q3). On the untouched new-Table path the same cell instead flips
the whole column's inference to Data (R2 #8) and nothing fails — a
different, correct outcome.

**Isolation strategy (required by §6):** this journey creates `Zones`
(renamed to a journey-owned name); since table deletion shipped
(`docs/specs/0003-table-deletion.md`, 2026-08-04) the spec **pre-cleans
its Table through the deletion capability instead of self-skipping** —
the create path runs on every database, used or fresh.

## IMP-J2 — Append: file to existing Table *(deltas from J1 only)*

| # | Where / do | Must observably see | Rules |
|---|---|---|---|
| J2.3′ | Read the target | The matching Table **already selected**, with a visible notice naming it and saying rows will be **added** — never silently | R7 |
| J2.3″ | Pick a different Table by hand | The same notice — the reassurance must not vanish exactly when the user chose the target themselves | R7 |
| J2.6′ | Look before committing | A way to **rehearse**: validate every row, see the same per-row errors a real run would produce, write nothing | R9 |
| J2.7′ | Wait | The existing rows *plus* the file's rows; nothing replaced | |

**Entry variant.** The Table's own list-view **Import** button opens the
wizard with that Table preselected (→ R7).

## IMP-J3 — A multi-sheet workbook *(a loop, not extra steps)*

For **each populated sheet, independently**: its own card, target, and
column grid — J1/J2 apply per card. An empty sheet is skipped without
comment. The user can skip any sheet and drop any column. Any whole-file
control (a validate-all button, a summary) must aggregate **per-sheet**
results, never evaluate a whole-file predicate (see H2).

## The rules

### IMP-R1 — Column naming · `shape: rule`

**Property:** for any header list, the output is the same length, every
name is a valid identifier of ≤ 63 chars, and **all names are distinct**.

Examples (agreement):

| File header | → column name | Why? |
|---|---|---|
| Zone Name | `zone_name` | lowercase, spaces to underscores |
| *(blank, 2nd column)* | `col_2` | named by position |
| Zone Name *(again)* | `zone_name_1` | duplicates suffixed; both keep their label |
| name | `name_1` | every row already has a built-in `name` |
| 2026 Total | `col_2026_total` | a name cannot begin with a digit |
| *(70-char header ×3, identical)* | three **distinct** truncated names | truncation must not silently merge columns |

> The last row is a live defect: today all three collapse to one name —
> confirmed by execution 2026-08-03; the uniqueness property catches it on
> the first randomised run. Issue pending (see matrix).

### IMP-R2 — Type inference · `shape: rule` (ordering is part of the rule)

Tested **in this order**:

| # | The values are… | → Type | Example / boundary |
|---|---|---|---|
| 1 | All yes/no (or true/false) | Check | Is Active |
| 2 | Whole numbers, none with leading zeros | Int | Population: 12000 |
| 3 | Numbers, some with decimals | Float | Area Sq Km: 45.5 — a column mixing 12000 and 45.5 is Float, never Int |
| 4 | Calendar dates, no time | Date | 2026-01-15 — same calendar day in every server timezone |
| 5 | Dates carrying a time | Datetime | 2026-01-15 09:30 |
| 6 | Text over 140 chars, or multiline | Text | a paragraph cell |
| 7 | Short text, few distinct repeated values | Choice | Region → R3 |
| 8 | Anything else, or an entirely empty column | Data | Zone Name; nothing to guess from |

**Digit strings that are codes, not quantities → Data:**

| The column holds | → Type | Why? |
|---|---|---|
| 007, 012, 350 | **Data** | a leading zero is content; Int destroys it silently |
| 12345678901234567 | **Data** | 16+ digits exceed 2⁵³; Float changes the value |

> Both rows are live defects today (Int and Float respectively; both
> confirmed by execution 2026-08-03, precision loss observable). The spec
> states the intended behaviour; the matrix records the gap and the pending
> issues.

**R2.7 — ordering guard.** *Is Active* clears the R3 promotion bar exactly
as *Region* does; it stays Check **only because the yes/no test runs before
the repetition test**. Consistency-testable even though R3 itself is
judgement-shaped.

### IMP-R3 — Choice promotion · `shape: judgement`

A short-text column becomes a fixed choice list when its values repeat
enough to read as a category. The thresholds (minimum sample count, allowed
distinct range, repetition density) are **named constants** to be recorded
in one ADR — bets, not facts. Verification per §4: corpus score +
consistency (same input same answer; row order irrelevant) + re-score on
any threshold change. Agreement anchors:

| The column holds | → | Why? |
|---|---|---|
| North ×4, South ×4 | **Choice**: North, South | repetition reads as a category |
| Eight distinct in eight rows | Data | a list of one-offs helps nobody |
| Nine distinct values | Data | past the point where a fixed list helps |
| Values >140 chars or multiline | never Choice | long text is content — R2 #6 classifies it as Text |

### IMP-R4 — Labels keep the file's wording · `shape: rule`

Only the database name is sanitized; the label stays the file's words,
lightly tidied — *Area Sq Km*, never *area_sq_km*. First four columns show
in the list view by default; a default, not a judgement.

### IMP-R5 — Table naming · `shape: rule`

`zones.csv` → **Zones**, editable before import; everything downstream
follows the *final* name (→ R6).

### IMP-R6 — Row identity · `shape: rule`

| Table name | Series shape |
|---|---|
| Zones | `ZONES-###` |
| Sales Invoice *(renamed first)* | `SALES-INVOICE-###` |

**The pattern is the promise, not the number** — the counter is global and
survives Table deletion; verify the shape, never a value. *(The file's own
reference numbers → Q4.)*

### IMP-R7 — Target matching · `shape: judgement`

Match scoring and coverage thresholds are named-constant bets (§4).
The behavioural anchors are firm:

| Situation | → | Never |
|---|---|---|
| A Table matches the sheet fully | Auto-selected **with a visible notice** that rows will be added | Silently |
| Partial match | Offered as a suggestion | Auto-selected — partial coverage drops data without the user deciding |
| Arrived from a Table's Import button | That Table preselected | |
| Nothing resembles the sheet | **New Table…** with R5's name | Aggressive fuzzy matching — a wrong auto-target costs more than none |

### IMP-R8 — Cell coercion · `shape: rule`

| The incoming cell / row | → |
|---|---|
| Clean | Coerced to the column type; dates keep their calendar day in every timezone |
| Uncoercible (`abc` in Int) | The row fails; **the others still land** (→ C1, I1) |
| Entirely blank row | Dropped silently — eight import, not nine (→ I1) |
| Empty cell in a normal row | Absent — not zero, not empty string |

### IMP-R9 — Rehearsal · `shape: contract`

Validate a file against the target with zero writes: same per-row error
report as a real run, no rows, no history entry (→ I3). Must exist on
**both** journeys — the first-time user (J1) is exactly the one who commits
blind. Rehearsal must evaluate the **whole file** in one scope: a duplicate
at rows 10 and 550 is one conflict, not two clean chunks (→ matrix,
suspected defect).

### IMP-R10 — The import record · `shape: contract`

Every real run writes **one** history entry (→ I2): target, file name,
inserted, failed, whether the Table was created. Rehearsals write nothing.
Import requires the same permission as creating rows by hand; refusal is
whole-request, and **any abort still writes the record of what already
landed** (→ H2).

### C1 — The import boundary · `shape: contract`

`POST /api/table/:table:import` has consumers beyond the wizard, so its
behaviours are requirements independent of any screen: insert semantics;
`dry_run` (validates, writes nothing, flags existing-name conflicts and
in-file duplicates file-wide); permission refusal is whole-request (403,
nothing partial); malformed rows are reported, not crashed; settings and
sub-table kinds are refused; the operation is registered as a write effect
(GET refused).

### IMP-R11 — Header-only files create the empty Table · `shape: contract`

*Decided 2026-08-04 (was Q1).* A file with headers and zero data rows
creates the Table with its inferred columns and no rows — schema-first
template workflows are legitimate. The Import Log records the run with
0 inserted, so it is still accounted for (→ I2). *Not yet built.*

### IMP-R12 — Re-import is an upsert on a user-mapped key · `shape: contract`

*Decided 2026-08-04 (was Q2 + Q4).* In the mapping step the user may mark
one file column as the **match key** — including mapping it onto the row
identifier, which the engine already accepts for direct sends. On import,
rows matching an existing key **update**; the rest insert; the log records
updated/inserted/failed separately. "I'll just import the corrected file
again" then does what everyone expects. *Not yet built.*

### IMP-R13 — An import can be undone · `shape: contract`

*Decided 2026-08-04 (was Q5).* The Import Log records the **ids of the
rows each run inserted**, and a run's history entry offers a one-click
reverse that deletes exactly those rows (updates from R12 record prior
values or are excluded from reversal — detail to settle at build time).
Closes the wrong-table trap directly. *Not yet built.*

### Invariants · `shape: invariant`

- **IMP-I1 — reconciliation.** For every run: rows in file = inserted +
  failed + dropped-blank, and every failure names the **true spreadsheet
  row** — a blank row above an error must not shift the blame onto an
  innocent neighbour. *(Re-executed 2026-08-03: the arithmetic holds; the
  row-number half is a confirmed defect — #115, pinned.)*
- **IMP-I2 — a chunked run reconciles.** The review demanded "one run, one
  record" and called per-chunk log rows a defect; the log schema's
  `part`/`parts` columns show they are design intent, so the storage
  invariant is restated with evidence: **one log row per part, every part
  present exactly once, and the parts' sums equal the run's totals.**
  Presenting a run as a single history entry is a UI grouping concern.
  *(Proven 2026-08-03.)*
- **IMP-I3 — rehearsal writes nothing.** No rows, no history, no series
  ids burned — the first real row after a rehearsal is the first of its
  series. *(All three proven 2026-08-03.)*

### Hazards

- **IMP-H1 — the wrong-table trap.** An import into the wrong Table can
  be neither stopped nor undone, and re-running the corrected file
  duplicates everything. *Resolution decided 2026-08-04:* R12 (upsert)
  + R13 (undo) + table deletion (hermeticity decision) disarm all three
  legs. The hazard stays listed until they are built and proven.
- **IMP-H2 — abort without a record.** A permission failure mid-import is
  reported to leave already-inserted rows behind with **no history entry**
  — the one failure mode guaranteed to strand rows is the one guaranteed to
  hide them. *(Reported; not yet re-executed.)*
- **IMP-H3 — whole-file predicates over per-sheet behaviour.** Any control
  that validates or summarises must aggregate per-sheet results; a
  whole-file predicate silently skips one sheet's problems in a mixed
  workbook. Distinct cause and fix from H2 — split on review feedback.

## Open questions *(arbiter: Siraj)*

| # | Question | Blocked on |
|---|---|---|
| Q3 | Error volume: 300 failures of 1,000 — how much detail survives, and where? (Today: five on screen, twenty in history.) | — |

*Graduated 2026-08-04 by the arbiter:* Q1 → R11 (create the empty Table) ·
Q2 + Q4 → R12 (upsert on a user-mapped key, identifier mappable) ·
Q5 → R13 (undo via row-identity logging). Per the change protocol, the
answers now live as rules and the questions are removed; only Q3 remains
open.

## Coverage matrix

**Verified against:** worktree at `ea821f8`, 2026-08-03. Tiers: `unit`
(pure logic) · `server` (real HTTP + Postgres) · `e2e` (Playwright).
Current tests carry legacy `IMP-001…013` titles; the join-key migration is
adoption item 1. Verdicts: **proven** · **conditionally proven** (passes,
but see caveat) · **rule tier only** (never witnessed in a browser) ·
**gap** (spec'd, nothing implements or asserts it) · **defect** (spec
violated by shipped code; three executed here, issues being filed) ·
**reported** (review's finding from reading or executing code, not
independently re-run here) · **open**.

The matrix's canonical home is
[`evidence/spreadsheet-import.csv`](evidence/spreadsheet-import.csv) —
one row per obligation with shape, strategy, static link, verdict, issue,
and stamp. CSV because this layer is genuinely tabular, diffable, and is
the exact shape that later lands as rows in Featherbase itself
(dog-fooding); this document keeps only the reading:

**Reading the matrix (2026-08-03):** three defects pinned expected-failing
(#110–#112) plus one known-gap with no evidence claim (#114) and one
pinned invariant (#115); two invariants and a chunk-run reconciliation
proven; three *reported* claims still awaiting re-execution (H2, H3,
cross-chunk rehearsal scope); two gaps; one conditionally-proven golden
path; two judgement rules without a corpus; five open questions. That
sentence — not a count of green rows — is the feature's true state.

---

# Part III — Adoption

## 1. Day one — free, self-maintaining, abandonable at no loss

1. **Requirement IDs into test titles** (the join key). Costs nothing;
   every CI failure starts naming the requirement it endangers.
2. **Extract the fixture into a fixtures folder** with a one-line claims
   file beside it.
3. **Fix the mis-scoped gap-pin** (Check-button absence: per-sheet, positive
   complement), then add absence assertions for the named gaps, polarity-
   tagged.
4. **Promote the ID scanner into CI** — and align its grammar with the IDs
   actually in use (it currently requires exactly three digits, which makes
   `EDS-1`-style IDs invisible to the only trace tool the repo owns).
5. **The two agent rules into `CLAUDE.md`** (§10).

## 2. Next — where the defects actually live

6. **Property tests for the inference rules** (R1, R2). All three executed
   defects sit here; highest value per hour in the proposal. **Landed
   2026-08-03:** `apps/server/test/import-properties.test.ts` (fast-check) —
   11 spec-true properties passing, the three defects pinned as `it.fails`
   against issues #110–#112 so each fix flips its pin.
7. **The invariants layer** (I1–I3) — reconciliation across a run.
   **Landed 2026-08-03:** `apps/server/test/import-invariants.test.ts` —
   I1 arithmetic proven and its row-number half confirmed as defect #115
   (pinned); I2 reframed with schema evidence and proven; I3 proven
   including the no-series-burn half.
8. **One ADR naming every threshold** as exported constants; spec and code
   reference names, never literals. **Landed 2026-08-03:** ADR 0008 +
   behaviour-preserving hoist across shared/import.ts, the wizard, and the
   import action (93 import tests green).
9. **Journey hermeticity** — decide the isolation strategy so the golden
   path stops self-skipping; make CI report skips as skips. **Decision
   brief (arbiter: Siraj):** *(a)* **Table deletion as a product
   capability** — no doctype-delete endpoint exists today (only row
   delete); this is the only option that also serves real users, it
   unblocks e2e cleanup naturally, and the project stage says interfaces
   are free to change. Interacts with Q5 (undo) and the delete-blocking
   reverse-lookup already in `document.ts`. *(b)* **Per-run table names**
   — cheap, but every CI run strands tables (issue #91's complaint) and
   the global series counter makes their ids non-deterministic. *(c)*
   **A dedicated e2e database reset between runs** — honest and simple,
   but punts local dev, where the drift actually bites.
   **Decided 2026-08-04: (a) — table deletion becomes a product
   capability** (with the existing reverse-lookup delete-blocking). Until
   it ships, create-path journeys stay *conditionally proven* and their
   skips must be reported as skips. **Shipped and proven the same day** —
   `docs/specs/0003-table-deletion.md` (the first greenfield journey-spec
   trial, #118); the create-path specs now pre-clean and IMP-J1 is
   *proven*.
10. **Adopt `feather-testing-core` as the e2e vocabulary** (Part I §6).
    Add the published dependency (≥ 0.2.0), an `e2e/fixtures.ts`, and
    write **new** journey tests in the DSL; migrate existing specs
    opportunistically alongside the join-key renaming. The formerly
    blocked-on verbs (`upload`, `dropFile`, `assertValue`, and the
    form-state assertion family) shipped upstream in 0.2.0 — the
    `feather-testing-postgres` policy held: fixed in its own repo, never
    vendored or patched locally. **Landed 2026-08-03:** dependency added,
    `e2e/fixtures.ts` (DSL `test` + composable `signIn`), the zones.csv
    fixture with its claims file, and the first journey spec
    (`import-journey.spec.ts`, IMP-J1). First dividends: the login form
    gained real label associations (`fillIn` refused the unassociated
    labels), and the spec surfaced defect #114 (wizard rename doesn't
    re-derive the series) plus a live demonstration of the hermeticity
    problem (item 9) — the fixture's headers auto-matched the leftover
    `Zones` Table, so the spec now proves R7's notice on used databases
    and the golden J1.3 on fresh ones.

## 3. Later — only if the earlier layers earn it

10. Labelled corpus for the judgement rules (synthetic, caveat recorded).
11. Mutation testing on the inference rules in CI (scoped; report surviving mutants).
12. Hazard register as a standing artifact beyond this spec.
13. Generated handle registry for the structural layer.

## 4. Deliberately deferred

Full elements/actions/states modelling; per-test coverage attribution;
requirements as rows in Featherbase itself (attractive, and circular — the
product cannot host its own spec before the product is trustworthy).

## 5. The missing document

Before the format is declared adopted, write the **author's walkthrough**:
one trivial requirement traced through every artifact it touches — spec
row, test title, matrix row, CI check. Cost of adoption is dominated by the
first hour; this is that hour, written down.

## 6. Relationship to feather-spec (the skill)

This is a **featherbase-local convention** until it survives 2–3 real
features. What graduates back into the skill when it does:

- §9 Scenario Rules gain the **shape tag** and the example/property split.
- The tasks template's "verify 100% coverage" line is replaced by mutation
  score + requirement mapping (§9 here — the `sanitizeHeaders`
  demonstration is the argument).
- Polarity tags, staleness stamps, and skip ≠ pass join the test-layering
  rules.
- The lens table gains the reviewer-agent lens (negative space).

What deliberately does **not** graduate: the committee (lenses won), the
structural layer by default (minimal mode governs), coverage percentages.

## 7. Change protocol

- **Behaviour changes on purpose** → edit the rule's example row or
  property; the failing test proves the guard works; same commit updates
  both.
- **A test fails with no spec edit** → a regression, by definition; the
  rule's Why column says what breaks if the test is "fixed" instead of the
  code.
- **An example and a property disagree** → the requirement is inconsistent;
  the owner arbitrates and all representations are updated together —
  never a silent tiebreak in either direction.
- **A question is answered** → it graduates into a rule or step, gains
  tests and a matrix row; the document's history is the decision log.

## 8. Scaling smells

A feature with six journeys is two features. A rule no step references is
dead behaviour or a missing journey. A fixture that cannot feed a new rule
is extended deliberately, never worked around inside one test. A matrix row
without a stamp is a hypothesis. A skip that reads green is a lie with a
timestamp.
