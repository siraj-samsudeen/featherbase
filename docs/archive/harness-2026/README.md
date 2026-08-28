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
- **`PROGRESS.md`** and the generated `site/*.html` dumps of it (see below,
  now at `docs/archive/harness-2026/site/*.html`) are dated records that
  mention `harness/` paths in the past tense. Those are history and were
  deliberately left alone.

## The Explorer (`site/`), retired 2026-08-28

`site/` was a single-file, zero-dependency static viewer: a feature board
rendered from `harness/features.json` (the same self-attested inventory
above, cross-linked to the tests and source files that mention each ID) plus
the design docs, ADRs and specs as a browsable library. `site/build.mjs`
generated it; `.github/workflows/pages.yml` was meant to build and publish
it to GitHub Pages on every push to `main` touching `site/**`, `docs/**` or
`PROGRESS.md`, self-provisioning Pages via `actions/configure-pages`'s
`enablement: true` step.

**It never worked.** Pages was never enabled on the repository, so every one
of the workflow's 56 runs between 2026-07 and 2026-08-24 failed (one was
cancelled) — verified 2026-08-28, the Pages URL still 404s. The Explorer was
never publicly visible; the only audience it ever reached was whoever
republished `site/artifact.html` by hand as a Claude artifact. Its Features
tab also renders the same self-attested board this README already retires
above, so the site had no independent reason to keep running even if the
workflow had worked.

**Owner ruling (2026-08-28, issue #236):** retire both, archived beside the
data the site renders. `site/` moved here wholesale (`git mv site
docs/archive/harness-2026/site`) and `.github/workflows/pages.yml` was
deleted outright — nothing links to it and it never succeeded once, so
there is no working state to preserve.

`site/build.mjs` still runs — `node docs/archive/harness-2026/site/build.mjs`
from the repo root regenerates `index.html` and `artifact.html` in place, so
the build isn't frozen the way `run.sh` below is (its `ROOT` was fixed up
for the new depth). Nothing about output changed; verified 2026-08-28 with a
clean re-run. The archived `site/index.html` still opens directly from disk
for anyone curious what the original build looked like — see
`site/README.md` for details.

## Running it

Don't. `run.sh` drives `claude -p` sessions against a scaffold that no longer
matches the prompts, and `diff-request.sh` needs a Frappe oracle this project
stopped speaking to.
