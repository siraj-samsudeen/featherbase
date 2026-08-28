# The 2026 build harness — frozen

**Frozen 2026-08-28** by owner instruction (issue #236), which explicitly
lifted the CLAUDE.md immutability rule that had protected `features.json`.
Nothing in this directory is live. Read it as history; do not use it to
decide what the codebase does today.

## What it was

The long-running-agent harness that built the first version of this project
(then `frappe-clone`) between 2026-06 and 2026-07, modelled on Anthropic's
harness-design engineering posts. Fresh agent context per session, all
continuity in the repo:

| File | Role |
|---|---|
| `harness/features.json` | The feature inventory — the original 126, plus entries added afterwards (145 in all at freeze). Each carries a one-line `verify` criterion, deps and a `status`. |
| `harness/prompts/` | The three session prompts: `initializer` (one-time scaffold), `coder` (one feature per session), `evaluator` (adversarial re-drive). |
| `harness/run.sh` | The outer loop — coder sessions, an evaluator pass every N, push after each. |
| `harness/README.md` | The harness's own description of the above. |
| `harness/render-features.mjs` | One-off renderer: `features.json` → a standalone HTML status board. |
| `harness/evaluation/` | A later, stricter grading protocol for work built *after* the 126: default-FAIL entries in `enhancements.json`, flipped only by a fresh-context evaluator reading real evidence. |
| `evaluator-agent.md` | That evaluator, as it lived at `.claude/agents/evaluator.md`. |

## Why it is frozen

**The statuses are self-attested.** A `"passing"` in `features.json` means the
session that built the feature said so at the time. That is a claim, not
evidence, and 144 of 145 entries read `passing` — so the file reports a
finished build rather than anything a reader can act on. Leaving it in the
working tree invited every future agent to orient by it and mistake a
2026-07 self-report for the state of the code.

**The evaluation protocol was never wired up.** `harness/evaluation/` grades
by differential comparison against a running Frappe instance as the oracle —
which requires Frappe wire-format parity, and CLAUDE.md architecture
invariant 4 retired that goal on purpose. No `evidence/` or `criteria/`
directory was ever created and every entry in `results.json` still reads
`false`; no evaluator ever ran.

**It has a successor.** Judgment and acceptance criteria now live in the
capability specs under `docs/specs/`, where each spec carries an evidence
matrix that must name the proof behind every verdict, and the proofs are
test suites CI actually executes. Feature IDs became capability IDs; the
`verify` line became EARS criteria plus an example table; a self-attested
boolean became a row that has to cite something.

## What survives outside this directory

- **Feature IDs** (`META-001`, `DOC-003`, `UI-002`, …) are still cited in
  test names, code comments and `PROGRESS.md`. They remain readable handles
  into this file. Nothing regenerates them and nothing checks them.
- **`site/`** — the published Explorer still reads `features.json` from this
  archive to render its feature board. It is the one live consumer; see the
  note in `site/README.md`.
- **`PROGRESS.md`** and the generated `site/*.html` dumps of it are dated
  records that mention `harness/` paths in the past tense. Those are history
  and were deliberately left alone.

## Running it

Don't. `run.sh` drives `claude -p` sessions against a scaffold that no longer
matches the prompts, and `diff-request.sh` needs a Frappe oracle this project
stopped speaking to.
