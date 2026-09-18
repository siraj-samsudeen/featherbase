---
name: code-review-8-axes
description: Review code against the eight design axes this repo holds itself to — unchecked assumptions, silent success, unenforced guards, duplicated facts, invisible dependencies, names that need a comment, words with two meanings, and shallow modules. Use when reviewing a diff or a module before a PR, when rewriting or refactoring a package, when the owner says "review this properly", "is this well designed", "audit this module", "what's wrong with this code", or "apply the 8 axes", "code review using 8 axes". Ranked by what actually breaks agent-maintained code, with real violations from this repo as worked examples, all verified against the source, and an explicit REJECT list so Clean Code's function-length and no-comments doctrine does not get imported by accident. Not a style checker — it finds defects that ship green.
---

# code-review-8-axes

## Overview

Eight axes, ranked by how much damage each defect does **in a codebase written by agents and maintained by agents**. Each axis carries one test you can actually apply, a real violation from this repo, and the shape of the fix.

This is not a style guide. Nothing here is about aesthetics, line counts, or formatting. Every axis targets a defect that **passes review, passes CI, and ships green** — and then costs someone a day.

Ported from the data-warehouse repo (#3664, from a design conversation with Siraj, 16-Sep-2026, and a read-only audit that found 123 items). The axes, the framing rules and the REJECT list are that skill's; **every worked example below was re-derived from this repo's own source** on 18-Sep-2026, because an axis illustrated by a Python data pipeline does not teach a reviewer reading TypeScript. Line numbers are as of that date — re-read before citing.

**Where the two repos differ, this file says so.** The data-warehouse skill was written against a package with zero assertions in 3,378 lines, fifteen copies of one status vocabulary, and a test suite that ran in no job that could fail a build. This repo is not that codebase: it has a live spec/evidence checker in CI, coverage ratchets, a transaction-per-test sandbox and unusually careful comments. Several axes therefore fire *quietly* here — and the honest review says so rather than manufacturing findings to fill the shape.

---

## The STC triangle — this skill is one vertex of three

| Artifact | Question | Skill |
|---|---|---|
| **Spec** | What should the system promise? | `spec-review-5-axes` |
| **Code** | Does it hold those promises? | `code-review-8-axes` |
| **Test** | Is each promise actually checked? | `test-review-3-axes` |

They drift apart continuously, whichever was written first. The edges are made greppable by **`docs/agents/stc-traceability.md`** (one `@spec <slug>` marker per vertex) and computed by `pnpm check:stc` for `openspec/specs`; `tools/check-evidence.mjs` computes the spec↔test edge for `docs/specs`.

**When artifacts disagree, never silently pick a winner and never punt.** Emit the divergence triage item defined in **`spec-review-5-axes`** — the disagreement, a recommendation, and what follows if the owner rules the other way. This repo already holds the rule in its own words: *"A discovered behaviour is not a requirement. It has three fates — ratified into the spec, filed as a defect, or raised as an open question — and choosing is the owner's call, never an agent's"* (`CLAUDE.md`).

---

## The three framing rules — read these before the axes

### 1. Unknown unknowns are the binding failure mode

Ousterhout's three symptoms of complexity: **change amplification** (one change, many edit sites), **cognitive load** (how much you must hold in your head), and **unknown unknowns** (you must change something and *cannot tell what*).

A human who wrote the code is partly immune to the third — they carry a mental model that whispers "careful, the PDF renderer filters on that list too". **An agent has no such process.** It boots cold, greps a symbol, reads 200 of 30,000 lines, edits, ships. Change amplification it usually survives. Cognitive load it survives expensively. Unknown unknowns kill it, because by construction there is nothing to grep for.

### 2. The owner is the binding reader — not the agent

This inverts the obvious. An agent can brute-force `apps/server/src/index.ts`'s 1,512 lines by burning context. A human debugging at 2am, on the path where agents have already failed, cannot.

**So design for the human and the agent gets it free. Design for the agent and the human is stranded.** Where an axis could be satisfied two ways, pick the one a human can follow without a tool.

### 3. Grep is not a defence, and neither is prose

The duplicate that bites is the one inside a JSX prop or a SQL template literal — invisible to a search for the constant's name. The invariant that bites is the one written in a docstring, because **prose cannot fail**.

> The defence is not "make it findable." The defence is **"make it impossible to be wrong quietly."**

This repo's own `CLAUDE.md` states the same rule from the other end: *"If a claim about the codebase cannot be checked mechanically, do not write it down as a fact."*

### And one thing to know about the author of the code

Agents are **structurally tactical**. An agent is rewarded for a green run at the end of one session and has no stake in session #40. That is not a flaw an agent can resolve by intending harder — it is the shape of the job.

Nobody decided the "columns that hold no value" set should live in seven places under three names. It accreted, one locally reasonable session at a time. **Strategic pressure has to come from the review gate, not from the agent's good intentions.** That is what this skill is.

---

## The eight axes

They form three tiers. The tiers matter: the first four catch code that **lies**, the last three are what let a human **find** the lie.

| # | Axis | Tier | The one-line test |
|---|---|---|---|
| 1 | Unchecked Assumption | Does it lie? | What does this assume that nothing verifies? |
| 2 | Silent Success | Does it lie? | Can this do nothing and still report OK? |
| **8** | **Unenforced Enforcement** | **Does it lie?** | **Does the guard it claims actually run, and does failing it stop anything?** |
| 3 | Duplicated Fact | Is the truth in one place? | Is this fact written down anywhere else — and is it still true? |
| 4 | Invisible Dependency | Is the truth findable? | If I renamed the canonical thing, would grep find every dependent? |
| 5 | Name That Needs A Comment | Can a human navigate? | Does this identifier need its trailing comment? |
| 6 | Word With Two Meanings | Can a human navigate? | Does this term mean something else somewhere else in the repo? |
| 7 | Shallow Module | Can a human navigate? | Can I use this without reading its body? |

**Axis 8 is numbered last and ranked third** — it was added after the other seven and renumbering would rot every worked example. Walk them in the table's order, not numeric order. Its rank is earned: it decides whether the *fix shapes* of the axes below it are real, since several of them prescribe "and CI checks for drift."

**Two things the review order also implies.** Axis 2 is the **amplifier** — an Axis 1 finding usually only *matters* because the path that breaks still reports success. And when ranking severity across axes: **can this create a silent permanent gap, or merely fail to detect one?** The first outranks the second every time.

---

### Axis 1 — Unchecked Assumption

**Rule.** Every invariant the code depends on must be **executable**. A precondition, a postcondition, an assertion, a schema constraint — something that fails loudly at the moment the assumption breaks.

**Source.** Bertrand Meyer, *Design by Contract* — preconditions, postconditions and invariants belong in the code, not the comments. Hunt & Thomas, *The Pragmatic Programmer* — **"crash early"**.

**The test.** Read every comment that asserts an invariant rather than describing behaviour, and ask: *does anything enforce this?* Then read each function and ask: *what must be true on entry that nobody checks?*

**Real violation — a freshness claim with three independent sources of truth.**

`apps/server/src/sales-target-report.ts:37` documents the field a reader sees:

```ts
/** least(period_end, source_as_of) — the cutoff actually applied to both sides. */
data_through: string | null
```

"The cutoff actually applied" is an equality, and three separate statements compute the number it rests on:

| # | where | statement |
|---|---|---|
| 1 | `datasets/sales-target-mtd.ts:61` | `select max(actuals_as_of_date) as as_of …` — becomes the snapshot's `source_as_of` |
| 2 | `datasets/sales-target-mtd.ts:34` | the `cutoff` CTE **inside the rows query** — decides which rows are actually cut |
| 3 | `sales-target-report.ts:156` | `select max(actuals_as_of_date) …` — the live (no-snapshot) path |

(1) and (2) run in **different statements over different connections** — `motherduckReader` builds a fresh `DuckDBInstance` per call — so they observe the mart at two moments. Nothing compares them. If the mart advances or is mid-rebuild between the two reads, the report says *"Data as of 15-Sep"* (`apps/web/src/pages/SalesTarget.tsx:202`) while the rows were cut at a different boundary, and no surface can tell.

**The fix shape** — make the assumption executable rather than described. Read the as-of **once** and pass it into the rows query as a parameter, so one value decides both; or, if two reads are unavoidable, return both and fail the build when they disagree:

```ts
if (fetched.sourceAsOf !== fetched.cutoffUsed)
  throw new Error(`as-of moved mid-build: ${fetched.sourceAsOf} vs ${fetched.cutoffUsed}`)
```

**Related, same module.** `dataset-snapshot.ts:25` states the loader's contract — *"Returns the row count written"* — and `datasets/sales-target-mtd.ts:136` returns `rows.length`, the length of the array it was **handed**. That number then gates activation (the >50%-drop refusal) and is displayed as the snapshot's `row_count`. With a plain chunked `INSERT` the two are equal unless the statement throws, so this is a **weaker** finding than it first looks — say so in the review rather than inflating it. What it does establish is that the *source* half is unchecked: a silently truncated superset under the 50% threshold activates and reads fresh.

> **A lesson about reviewing, not about this bug: the first draft of this finding claimed the insert count was unverified and left it there. Chasing it to the end — what does `postgres` actually return, what would have to happen for the counts to differ — turned a dramatic finding into an accurate smaller one. Do that before reporting, not after.**

---

### Axis 2 — Silent Success

**Rule.** No code path may do nothing, or do the wrong thing, and report success. Success must be *verified*, not *assumed from the absence of an exception*.

**Source.** Ousterhout ch. 10, *define errors out of existence* — and its corollary: where an error genuinely exists, it must be impossible to swallow. Axis 1 is the assumption nobody checked; Axis 2 is the result nobody checked.

**The test.** For every function that reports an outcome: **"what is the path where this does nothing at all and still returns OK?"** Then: *is the thing I'm reporting the thing that actually happened, or a proxy for it?*

**Real violation — a catch that names one cause and covers four.** `apps/server/src/realtime.ts:119–152`:

```ts
socket.on('message', (raw) => {
  void (async () => {
    try {
      const msg = JSON.parse(String(raw)) as { subscribe?: string[]; unsubscribe?: string[] }
      const registered: string[] = []
      for (const ch of msg.subscribe ?? []) {
        if (await canSubscribe(client.user, ch)) { client.channels.add(ch); registered.push(ch) }
      }
      …
      if (registered.length && socket.readyState === socket.OPEN) socket.send(/* the ack */)
    } catch {
      // ignore malformed frames
    }
  })()
})
```

The comment names **parsing**. The block also covers `canSubscribe` — a permission lookup that reaches the database — and the ack `send`. So a database blip during a subscribe is handled as "malformed frame": the client gets no ack, no error, and no subscription, and #224 added that ack precisely so a client would not have to guess with a sleep. **The one failure the ack exists to make visible is the one this swallows.**

Note what is *not* wrong here: dropping an **unpermitted** channel silently is deliberate and documented, and the ack-by-omission design is the mitigation. The defect is the catch's width, not the policy.

**The fix shape** — narrow the catch to the thing the comment names, and let the rest be a real error:

```ts
let msg
try { msg = JSON.parse(String(raw)) } catch { return }   // genuinely a malformed frame
// authorization and ack outside the parse guard; a failure here is an error, not a shrug
```

**Where else to look for this shape in this repo:** `.catch(() => …)` on a path whose failure changes a decision, and any `catch` whose comment names a narrower cause than the block covers. Both are one grep.

---

### Axis 3 — Duplicated Fact

**Rule.** Every piece of knowledge has **one authoritative home**. Everything else is derived from it, generated from it, or does not exist.

**Source.** Hunt & Thomas: *"Every piece of knowledge must have a single, unambiguous, authoritative representation within a system."*

The word doing the work is **knowledge**. This is **not** "don't write similar-looking code" — that misreading produces bad abstractions built to satisfy a rule. The unit is a *fact about the world*: a set of valid types, a threshold, a default, a table name, an enumerated vocabulary.

**A spec is a SANCTIONED duplicated fact.** Where a spec covers this code, it is by construction a second representation. The duplication is accepted; **the price is that drift must be detectable.** So: does the code agree with the spec, at the grain the spec claims? Does the evidence pointer reach the code that *decides* the behaviour, or only its caller? Disagreement → a divergence triage item, not a fix.

**Real violation — one fact, seven homes, three names.** "Column types that hold no value" (layout markers and sub-tables — the columns you must skip when reading or writing a row):

```
apps/server/src/query.ts:93            NO_COLUMN_TYPES  = new Set([...])
apps/server/src/document.ts:72         NO_COLUMN_TYPES  = new Set([...])
apps/server/src/sources/dispatch.ts:20 NO_COLUMN_TYPES  = new Set([...])
apps/web/src/lib/meta.ts:63            NO_COLUMN_TYPES  = new Set([...])   (exported)
packages/shared/src/schema.ts:16       NO_VALUE_TYPES   = new Set([...])
apps/web/src/pages/TableMerge.tsx:27   SKIP_TYPES       = [...]            (different order)
apps/server/src/print.ts:118           an INLINE ARRAY LITERAL, no name at all
```

All seven are `['Sub-table', 'Section Break', 'Column Break']` today. The failure is what happens when the vocabulary grows — and it is a vocabulary that grows: `COLUMN_TYPE_VALUES` is an 18-entry list that has gained entries before. Add one layout type and a reviewer must find all seven; miss `print.ts:118` and the PDF renders a layout marker as a field, miss `schema.ts:16` and zod demands a value for a section break.

**And the home already exists.** `CLAUDE.md` says `packages/shared` is "types and contracts used by both sides", `apps/web` already imports from it (`tableSchemaToZod`, `inferColumnType`, `seriesPrefix`), and `schema.ts` holds one of the copies. The fact has a house and six squatters.

**Second instance, same shape:** the whole column-type vocabulary is declared twice — `apps/server/src/meta.ts:6` `COLUMN_TYPE_VALUES` and `apps/web/src/lib/meta.ts:65` `COLUMN_TYPES`. Identical today, verified by hand; nothing makes them stay identical. A type the server accepts and the Admin cannot render is a Table you can create by API and not edit in the UI.

**Third, subtler:** which columns can be summed. `query.ts:414` `SUMMABLE_TYPES` decides server-side; `ReportView.tsx:10` `NUMERIC` decides which columns the report *offers* a sum for. Same fact, two homes, opposite sides of the wire — drift shows up as a UI that offers a sum the server rejects.

**The fix shape, in order of preference:**
1. Delete the copy; import the original from `packages/shared`.
2. Generate the copy from the original, with a check that fails on drift.
3. Where neither is possible, **assert the relationship** so the drift is loud.

---

### Axis 4 — Invisible Dependency

**Rule.** Every cross-file contract must have exactly **one unique, greppable token**, and every site that depends on the contract must contain that token.

**Source.** Local to the origin repo — the operational complement to Axis 3. Axis 3 says one home; Axis 4 says the dependents must be *findable from* that home.

**The test.** Take the canonical definition. Ask: **"if I renamed this right now, would `grep` return every place that depends on it?"** Any dependent that would survive the rename silently is an invisible dependency.

**Where they hide in this repo** — in each case the dependency is real and the token is absent:

- **The unnamed literal.** `apps/server/src/print.ts:118` filters on `['Sub-table', 'Section Break', 'Column Break']` inline. Grep for `NO_COLUMN_TYPES` and the PDF renderer does not appear — the one surface where a missed layout type is visible to a customer.
- **The renamed copy.** `apps/web/src/pages/TableMerge.tsx:27` calls it `SKIP_TYPES`. Same fact, different token, different order; no grep joins them.
- **A named constant with no counterpart across the wire.** `apps/server/src/meta.ts:60` defines `ROW_KEY = 'row_id'` and the server uses it in ~75 places. `apps/web` never imports it — the wire key appears there as a bare string (`ListView.tsx:183`'s sort expression) and as ~270 property accesses. The server half of the contract is greppable; the client half is not.

**The fix shape.** Give the contract a name and make every site say it: a shared constant imported by name, a named type, or — where the literal genuinely cannot be replaced (a SQL fragment, a JSX prop) — a distinctive marker token in a comment at that exact line, so one grep still returns all of them. `docs/agents/stc-traceability.md`'s `@spec` marker is this rule applied across artifacts rather than within code.

---

### Axis 5 — Name That Needs A Comment

**Rule.** **The name carries the *what*. The comment carries the *constraint*.**

- If a comment explains *what the thing is* → the name failed. Fix the name, delete the comment.
- If a comment states something the code **cannot show** — an invariant, a measured fact, a dependency in another file, a reason the obvious approach fails — it is load-bearing. **Never delete it.**

**Source.** This resolves a real fight. Robert C. Martin (*Clean Code*) says a comment is a failure to express yourself in code. John Ousterhout (ch. 12–16) says comments capture what code cannot. **Both are half right, and the split above is the whole of it.**

**The test.** For every identifier in the diff: **does it need its trailing comment?** The comment's existence *is* the evidence.

**Real violation — the name says nothing, and there is no comment to rescue it.** `NO_COLUMN_TYPES` is defined bare — no comment — at `query.ts:93`, `document.ts:72` and `sources/dispatch.ts:20`. Read at a call site:

```ts
if (NO_COLUMN_TYPES.has(f.column_type)) continue
```

"No column types" reads as *an absence of column types*. The meaning is "column types that hold no value". The sibling in `packages/shared/src/schema.ts:16` gets it right — `NO_VALUE_TYPES` — which is the tell: **when the same set has a good name in one file and a bad one in four, the bad one is not a matter of taste.**

**Real violation — two keys, one word.** `ROW_KEY` (`meta.ts:60`) is the **wire** key, always `'row_id'`. `meta.row_key` (`meta.ts:288`, from `physicalRowKey()`) is the **physical** column, which is `'name'` for the `Table` table. Two different keys distinguished only by where you read them from, which is why `query.ts:159` needs a translator whose whole job is the difference:

```ts
const phys = (field: string) => (field === ROW_KEY ? meta.row_key : field)
```

The translator is good and must stay (it is the named boundary Axis 6 asks for). The **names** are the defect: `ROW_KEY` / `row_key` differ by case, and case is not a distinction a human reading at 2am can lean on. `WIRE_ROW_KEY` and `meta.physical_row_key` would end it.

**What this axis does NOT say.** Nothing about length. A single-letter name inside a three-line map is fine.

**A positive example worth keeping.** `meta.ts:62–72`'s `PHYSICAL_ROW_KEY_OVERRIDES` carries a thirteen-line comment explaining why `table_def` keeps a natural key. That comment states a constraint the code cannot show, and its existence is not evidence against the name. Keep it.

---

### Axis 6 — Word With Two Meanings

**Rule.** Every domain term has **one definition, in one findable place**, and means the same thing everywhere in the repo. Where two areas genuinely need the same word for different things, the boundary between them is **explicit and named**.

**Source.** Eric Evans, *Domain-Driven Design* — Ubiquitous Language and Bounded Context.

**The test.** For every domain term the diff introduces or uses: **is it defined in `docs/GLOSSARY.md` or `CONTEXT.md`? Does it already mean something else somewhere in this repo?**

**Real violation — `name`, which means three things.** `docs/GLOSSARY.md` is unusually good and defines **Row**, **Table**, **Column**, **Tier** and twenty more. It does not disambiguate `name`, and `name` currently means:

| meaning | where |
|---|---|
| a **Table's** identifier (`'Student'`) — a natural key, deliberately kept | `table_def.name`; `meta.ts:62–72` explains it |
| a **row's id** — the parameter name throughout the row engine | `submitDoc(table, name)`, `getDoc(table, name)`, `deleteDoc`, `renameDoc`, `amendDoc`; routes `/api/print/:table/:name`; `ActionContext.name` |
| an ordinary **user column** — explicitly re-permitted by #132 | `meta.ts:58`: *"a user Table may finally have a plain `name` column (Student.name, Customer.name)"* |

The wire format was renamed to `row_id` (#132) and the *internal* vocabulary was not. The result reads like this, in `actions/collection-import.ts:290`:

```ts
const name = String((row as Record<string, unknown>)[ROW_KEY] ?? '').trim()
```

A variable called `name` holding the row id, read out of the key constant called `ROW_KEY`, in a file that also handles Tables which may have a user column called `name`. **A false friend is more dangerous than an undefined word:** an undefined word makes a reader ask; a false friend lets them proceed confidently in the wrong direction — here, mapping a user's `name` column onto a row id.

**Real violation — a retired word, still spoken to the user.** Migration `0055_terminology_rename.sql` renamed `docstatus → status` across the database. One user-facing string kept the old word (`apps/server/src/table-engine.ts:166`):

```ts
errs.is_submittable = 'A source-bound Table cannot be submittable (no docstatus on the source)'
```

An admin who reads that error and searches the product for "docstatus" finds nothing: `docs/GLOSSARY.md` does not have it, the schema no longer has it, and `CLAUDE.md` is explicit that the retired vocabulary survives only where it is a dated record of the past. The fix is one word — *"(the source has no submit lifecycle)"*.

**And the instance that is NOT a violation, because this is where reviews go wrong.** `docs/specs/0001-external-data-sources.md:146–151` uses `docstatus` in SHALL statements. That spec is about binding to a **foreign Frappe database**, where `docstatus` is the actual column name on the actual source table. Naming another system's column by its real name is correct and must not be "fixed". **Always establish which system a word belongs to before calling it a leak.**

**The fix shape.** Define it in `docs/GLOSSARY.md` if the product says it; define it in one place if it is ours. Where two contexts share a word, rename one, or make the boundary a single named translator and say in its doc comment that it *is* the boundary.

---

### Axis 7 — Shallow Module

**Rule.** A module should be **deep**: a simple interface hiding substantial functionality. The defect is the inverse — an interface nearly as complex as the body it wraps, so the module costs more to use than it saves.

**Source.** Ousterhout, ch. 4 and 9.

**The test.** **"Can I use this without reading its body?"** If the answer requires knowing what the implementation does, or reading the call sites, the module is shallow.

**Explicitly NOT the test: length.** A 300-line function with one honest signature and no hidden coupling is fine. A 15-line function that only makes sense once you have read its three callers is not.

**Real violation — the dry run is a hand-maintained twin of the real path.** `apps/server/src/document.ts:440` `checkRowForInsert` is the validation-only pass the import wizard runs before writing. Its own doc comment admits the seam:

> *"Automation triggers and tier stripping do not run here, so a trigger can still reject at real import time; the dry run catches everything schema-level."*

and, three lines further down, records a repair:

> *"#231: the real import inserts through saveDoc, so the dry run has to apply the same required-children rule or it would pass rows the import then refuses."*

That is the defect stated by the code itself. `checkRowForInsert` cannot be understood or used without reading `saveDoc`'s insert path, because its correctness is *"agrees with that path, for the subset it claims"* — and the agreement is maintained by hand. It has already fallen out of step once (#231) and was fixed by copying the rule across rather than by removing the possibility.

Note what is **not** the finding: the split itself. A dry run is a genuinely useful capability and this is the ordinary way to build one. The finding is that the agreement is **undetectable** — nothing fails when the two diverge, so the next validation added to `saveDoc` silently makes the dry run over-permissive, and the symptom lands on a user mid-import.

**The fix shape.** Make the shared rules one function that both paths call (`schemaLevelChecks(meta, values)`), so "the dry run runs the schema-level subset" becomes true by construction instead of by maintenance. Where a full merge is not possible, a test that runs both paths over one corpus and asserts they agree on every row converts an invisible divergence into a red build.

**Two smaller members of the family, worth the same question:** a pass-through method whose body is one call with the same signature; a return value every caller discards.

**An open architectural question this skill does NOT settle.** `packages/shared` currently holds zod schemas and import inference, while several facts both sides need (Axis 3's seven copies) are not there. Whether shared should own the vocabulary is a design decision with real costs — bundle size, coupling of release cadence. Flag it in a review; do **not** unilaterally "fix" it. That is the owner's call.

---

### Axis 8 — The Unenforced Enforcement

**Rule.** Every guard the code claims — a test, a CI check, a validator, a schema constraint, a lint — must **currently execute**, and its failure must **stop something**.

**Source.** Added to the origin skill after a reviewer found it by accident while chasing Axis 4, and it outranked most of what the named axes found.

**The test.** *Find the job that runs it.* If it is `continue-on-error`, advisory, path-filtered away from the code it guards, or currently failing to import — **the guard does not exist.**

**Real violation — a ratchet that was never ratcheted.** `apps/server/vitest.config.ts` sets a coverage floor and says, in its own comment:

> *"Measured 2026-08-28 on a developer checkout: lines/statements 86.64% … That local run is a FLOOR, not the true figure — `sources-mysql.test.ts` skips itself without `MYSQL_TEST_URL`, leaving `src/sources/mysql-driver.ts` (359 lines) at 6%, and CI does set that variable. **Raise these to the number the first green CI run reports.**"*

The thresholds are still `lines: 86, statements: 86, functions: 91`, three weeks later. CI *does* set `MYSQL_TEST_URL`, so the real figure is higher and the gap between the floor and the truth is exactly how far coverage can fall — including all 359 lines of the mysql driver — without failing a build. The guard runs; it just cannot currently catch what it was sized to catch. **A guard whose threshold is knowingly slack is a guard that reports on itself, not on the code.**

**Real violation, smaller — a documented check that no job runs.** `pnpm smoke` is named in `README.md:31`, `CLAUDE.md:171`, `docs/TESTING.md:109` and `docs/ARCHITECTURE.md:334`, and runs in `init.sh:271`. `.github/workflows/test.yml` never invokes it. Its web half is covered anyway (Playwright runs `e2e/smoke.spec.ts` inside the e2e job), so the honest consequence is narrow: the **server** half — `tsx src/smoke.ts` asserting a booted server answers `/api/ping` with `db: true` — is a developer-machine check that four documents present as a project check. Report it with that consequence, not with a bigger one.

**And the one this change itself introduces.** `pnpm check:stc` is not in CI (see `docs/agents/stc-traceability.md` for why, while OpenSpec is on trial). It is stated there rather than left implied, because an unenforced guard that reads as enforced makes the next agent stop looking. **If your review adds a guard, apply this axis to your own guard before you finish.**

**A spec is a guard too, and usually an unenforced one.** `openspec validate --specs --strict` proves the spec is **well-formed, not true**: it reported *1 passed, 0 failed* on `openspec/specs/table-deletion/spec.md` before a single requirement had been checked against the code. Ask: *what detects spec-code drift, and does failing it stop anything?* `pnpm check:stc` checks only that the vertices reference each other, never that they agree.

**Two smaller members of the same family:**

- **A stated contract the *default* configuration violates.** Read every doc-comment claim against the **default** path, not the first one you find.
- **A runbook prescribing a hand-edit the code could make unnecessary.** Hunt & Thomas: *don't use manual procedures.* Ask: *does a doc document a repair the code should be doing itself?*

**Two guards in this repo that pass this axis, and are worth copying.** `tools/check-evidence.mjs` refuses to count a `.skip`ped test as proof, refuses a spec that silently opts out, and is itself mutation-tested — *"A green linkage check means nothing if the checker cannot fail"* (`.github/workflows/test.yml`). And `apps/server/scripts/check-sql-escapes.ts` looks like a standalone script no CI job runs — but its `checkMigrations()` is imported by `apps/server/test/choices-newline.test.ts:107`, so it gates through the suite. **Chase the import before reporting a guard as dead; this one refutes the obvious reading.**

---

## How to run a review

1. **Scope it — then deliberately leave it.** Name the files. Then name the **consumers**, because Axis 3 and Axis 4 only do their damage outside the module: the PDF renderer that filters on its own copy of a list, the Admin that offers a sum the server will refuse. Whole-package audits are for a dedicated session.
2. **Walk the axes in the table's order.** They are ranked by consequence. Do not start at 5 because naming is easy to see.
3. **Cite `file:line` for everything.** A finding without a line number is an opinion.
4. **Verify before reporting.** A single-pass finding is a hypothesis. Open the file and confirm it. Mark each finding **VERIFIED** or **UNVERIFIED** and never present the second as the first. Where a claim can be *tested*, test it — see the refuted list below for one that took ninety seconds and killed a whole finding.
5. **State the failure, not the smell.** "This is duplicated" is a smell. "Adding a fourth no-value column type changes six named copies but not the inline literal at `print.ts:118`, so the PDF renders a Section Break as a field" is a finding.
6. **Do not fix while reviewing.** Findings and fixes are separate acts, and separate PRs. See the Boy Scout Rule in the REJECT list.

### Output format

Group by axis, most severe first within each. Per finding:

```
[VERIFIED] Axis 2 — Silent Success
  apps/server/src/realtime.ts:151
  `catch { // ignore malformed frames }` spans JSON.parse, the canSubscribe
  permission lookup and the ack send. A database failure during subscribe is
  handled as a malformed frame: no ack, no error, no subscription.
  Failure: the client waits for an ack that never comes and misses every event
  on that channel — the exact case #224's ack was added to make visible.
  Fix shape: narrow the try to JSON.parse; let authorization failures be errors.
```

Close with a count per axis, the single worst finding overall, and a **refuted list** — every suspicion you investigated and dropped, with why. A refuted hypothesis is a real result.

**The refuted list from the audit that produced this file**, as the worked example of what belongs there:

- *"`packages/shared` is missing from CI's typecheck steps, so a type error there ships."* **Refuted by experiment.** Appended a deliberate type error to `packages/shared/src/schema.ts` and ran each package's typecheck: **server and web both failed**, naming `../../packages/shared/src/schema.ts(98,7)`. Both tsconfigs follow the import into shared's source. Ninety seconds; the finding was wrong.
- *"`docstatus` survives in `docs/specs/0001`, so the terminology rename is incomplete."* **Refuted.** That spec describes binding to a foreign Frappe database, where `docstatus` is that system's real column name.
- *"`pnpm lint:sql` runs in no CI job, so the SQL-escape guard is dead."* **Refuted.** `apps/server/test/choices-newline.test.ts` imports `checkMigrations` and asserts it returns no hits, so the guard gates through the vitest suite.
- *"The e2e acceptance spec for sales-target skips itself when its shared inputs are absent, so an obligation could read proven while nothing ran."* **Refuted for the CI path.** `check-evidence.mjs` treats a Playwright `skipped` result as not-executed and fails a `proven`/`rule-tier` verdict backed only by skipped tests. It remains true that the *static* pass cannot see a runtime `test.skip`, which is why the runtime pass exists.

---

## The REJECT list — rules this repo deliberately does NOT hold

Recorded so that a future agent does not import them from training and start "improving" things.

| Rejected | Source | Why |
|---|---|---|
| **Functions ≤ 20 lines / "do one thing"** | *Clean Code* | Produces shallow and conjoined modules — ten names, ten call sites, nothing hidden. **Raises** cognitive load. Axis 7 is the real test; length is not a proxy for it. |
| **"Comments are a failure to express yourself in code"** | *Clean Code* | Deletes the one artefact that defends against unknown unknowns. This repo's comments are unusually load-bearing — `meta.ts:62`, `vitest.config.ts`, `choices-newline.test.ts` each carry an incident nobody could reconstruct from the code. Axis 5 states the correct split. |
| **The Boy Scout Rule** (clean up as you pass through) | *Clean Code* | Actively harmful for agent work: it buries the fix inside unrelated tidying and makes the diff unreviewable. **Unrelated cleanup gets its own issue.** |
| **DDD tactical patterns** (Entity / Value Object / Aggregate / Repository) | Evans | OO ceremony for large domain models. Applied here it manufactures Axis 7 defects. Take Ubiquitous Language and Bounded Context (Axis 6); leave the rest. |
| **Test coverage targets** | — | Measures lines executed, not invariants protected. **Count contracts, not percentages.** (This repo *does* run coverage ratchets; they are a regression alarm, not a quality target — and Axis 8 above is about one that stopped being either.) |
| **File length as a defect** | — | Not a finding on its own. `index.ts` at 1,512 lines is a symptom worth investigating under Axis 7, never a finding under it. |

---

## The owner's standing rules

From Siraj (via the origin repo, 16-Sep-2026) and binding on this skill:

- **File length is not a problem. Function length is not a problem.** Do not report them.
- **Unnecessary repetition is a problem** (Axis 3).
- **Technical, jargony names that require a comment are a problem** — a self-evident name that expresses the thing is always preferred (Axis 5).
- **The file organisation must let a human operate independently.** The case that matters is the one where agents cannot do something and the owner has to go in and fix it themselves (Axis 6, and framing rule #2).
- **Pure aesthetics do not matter.** If a finding cannot be expressed as a concrete failure, it is not a finding.

And this repo's own hard rules, which this skill does not restate but which a reviewer enforces: **nothing is `done` on an agent's word** — record the command, not the verdict; **no expectation laundering** — never weaken an assertion to obtain a passing run; **a discovered behaviour is not a requirement**.

---

## Provenance

| Idea | Source |
|---|---|
| Three symptoms of complexity; deep modules; strategic vs tactical; comments describe what code cannot | John Ousterhout, *A Philosophy of Software Design* |
| Preconditions, postconditions, invariants as executable contracts | Bertrand Meyer, *Design by Contract* / Eiffel |
| DRY as **knowledge**, not code; crash early; don't use manual procedures | Hunt & Thomas, *The Pragmatic Programmer* |
| Ubiquitous Language; Bounded Context | Eric Evans, *Domain-Driven Design* |
| Intention-revealing names (the half we keep) | Robert C. Martin, *Clean Code* |
| Tests as executable specification | Kent Beck, *TDD* |
| Axis 4 (greppability), Axis 8 (unenforced guards), the framing rules | data-warehouse `code-review-8-axes` (#3664) — Siraj, 16-Sep-2026 |

Evidence base: a read-only audit of `apps/server/src`, `apps/web/src` and `packages/shared/src` on 18-Sep-2026. Every worked example above was opened and confirmed; four suspicions were refuted and are listed as such.
