# Evidence verdicts — one line per obligation, inside the spec

Evidence used to live in a hand-maintained CSV beside the spec. It was a
join table between specs and tests, and join tables should be derived and
checked, not curated: its file-path links made moving a test a breaking
change, and its date stamps drifted. Retired 2026-08-28 (issue #235).

Now **the verdict lives on the obligation it judges**, and the linkage is
re-derived by `tools/check-evidence.mjs` on every CI run.

## The verdict line

Directly under the declaration — the heading of a journey or rule, or the
last line of an invariant's or hazard's bullet:

```markdown
### FEAT-R3 — Match resolution · `shape: rule`

> evidence: proven — the example table row for row, plus a property over
> hostile files; resolution is against the database, not the chunk.
```

Grammar — everything before the em-dash is machine-read, everything after
it is prose:

```
> evidence[ <ID>]: <status>[ #<issue>][ via <ID>[, <ID>…]] — <note>
```

| Part | When to use it |
|---|---|
| `<ID>` after `evidence` | Only for a **sub-ID** whose verdict differs from its parent's (`> evidence FEAT-R6.shape:`). Omit it and the line attaches to the declaration above. |
| `#<issue>` | Required by `pinned`; welcome on `gap` when an issue tracks it. |
| `via <ID>…` | Names the test titles that prove this ID **without quoting it** — a legacy title, a covering journey, a rule proved inside a sibling's test. The ID's own name always counts too; `via` only adds aliases. |
| `— <note>` | What was actually executed, and every caveat. Required for `gap`, `rule-tier` and `pinned`. |

## Status vocabulary

Four statuses, because the checker has to act on them:

- **`proven`** — the strategy ran and passed at its intended tier. A
  caveat does not demote it; write the caveat in the note (this absorbs
  what the CSV called *conditionally-proven*).
- **`rule-tier`** — proven below the tier the shape demands: a rule
  never witnessed in a browser, a judgement with anchors but no labelled
  corpus.
- **`gap`** — nothing implements or asserts it. This is also the honest
  status for *decided but not yet built*, and for a review's claim that
  was never re-executed — say which in the note.
- **`pinned #N`** — an `it.fails`/`test.fail` asserts the SPEC and goes
  green only because the failure is expected; fixing the defect flips it
  loudly. Where an expected-failing test is impractical, use `gap #N`
  with a note saying no evidence claim exists until it is fixed.

## The participation contract

**A document declares whether it is accountable; silence is a failure.**

- Every `.md` under `docs/specs/` must carry either an `**IDs:**` line or
  `**Evidence mode:** excluded — <one-phrase reason>`. A file with
  neither fails the run by name; a file with both fails too. (The index,
  `docs/specs/README.md`, declares its own exclusion — there is no
  exemption list inside the checker to go stale.)
- `docs/design/` is watched rather than required: a design note is not a
  spec and need not declare. But a design document that **carries
  obligations** — any `> evidence:` line outside a code fence — must
  declare exactly as a spec does. That is what stops a future
  obligations-bearing doc from being ignored in silence.
- An excluded document may not carry verdict lines, and an `**IDs:**`
  line naming no `` `pattern` `` fails rather than silently owning
  nothing.

Adding a document that declares obligations somewhere else? Add its
directory to `REQUIRED_SPEC_DIRS`/`WATCHED_SPEC_DIRS` in the checker, in
the same change.

## What the checker enforces

`node tools/check-evidence.mjs` (`pnpm check:evidence`, and a CI step;
the checker's own mutation tests are `node --test tools/*.test.mjs`):

1. **Every declared ID carries a verdict** — or a sub-ID of it does. A
   new rule cannot ship unjudged.
2. **Every `proven` and `rule-tier` verdict has a matching test title.**
   Test titles are the join key, so only `describe`/`it`/`test` names are
   scanned. If the proving title does not carry the ID, name it with
   `via` — never quietly leave the claim unbacked.
3. **Only an executable title counts.** `.skip`, `.todo`, `.skipIf`,
   `.runIf` — anything outside the allowlist of unconditional modifiers —
   and anything inside such a suite, proves nothing. `.fails` is
   matchable but never satisfies `proven`: an expected failure records
   that the behaviour is broken. And a `describe` title counts only while
   an executable test still runs inside it, so emptying a suite does not
   leave its name standing as proof.
4. **Every `gap`, `rule-tier` and `pinned` verdict says why.**
5. **A `pinned #N` verdict needs a real pin**: an executable
   expected-failure declaration (`it.fails`/`test.fails`, not skipped,
   not inside a skipped suite) whose **title carries both the pinned ID
   and `#N`**. An issue number in a comment, or anywhere else in the
   file, is not a pin — so the pinning title must quote the sub-ID it
   pins (`it.fails('FEAT-R2.leading-zero: … (pins #111)')`).
6. **Every `via` alias names a title that exists.** An alias nothing
   carries is a dead pointer and fails.
7. IDs in test titles that no spec declares are reported as **warnings**
   — a test may pin a defect by issue number alone, which is fine.

What it cannot see: whether an executable test asserts anything. That is
a review question, not a static one.

## Rules that survive from the CSV era

- Never mark a grouped ID `proven` when one clause is violated — give the
  violated clause its own sub-ID verdict and let the parent stay silent
  (a parent needs no line of its own once a sub-ID carries one).
- A skipped test never contributes to `proven`.
- Static traceability is a **linkage claim, never execution evidence**:
  the checker proves a test exists and names the rule, not that it ran.
- Update the verdict in the same change as the tests it describes. Its
  date is the commit's; do not stamp it by hand.
