# ADR 0023: Coverage ignores sit at the unreachable spot, with a reason, after research

**Status:** Accepted · **Date:** 2026-11-10 · **Supersedes in part:** [ADR 0017](0017-backend-coverage-non-regression-baselines.md)'s "no new exclusions or ignores" rule, for code no test can reach

## Context and Problem Statement

ADR 0017 caps the uncovered count of each coverage measure and allows no new
ignores. A cap is an aggregate budget: covering one item makes room for a new
uncovered one, so a gap can move unnoticed while the number stays the same.

After the branch-coverage passes, lines and functions are fully covered and
only a handful of statements are left. Several spots first written off as "no
test can hold that window open" (a row deleted between two reads, a scope
provider turned off mid-read, the Admin index after the address moved) turned
out to be reachable: a module mock in a test file of its own holds the window
open. So "unreachable" is a claim to research, not to assume.

## Considered Options

- Keep a negative cap for every measure, with exceptions named in prose in the
  config: a new uncovered item can offset a newly covered one, and the prose
  drifts from the code.
- Exclude whole files: hides reachable code with the unreachable.
- Ignore a spot inline as soon as it looks hard to reach: quick, but most such
  spots yield to a technique not yet tried.
- Ignore a spot inline, with its reason, only after research shows no test
  can reach it.

## Decision Outcome

Chosen by the owner on 10-Nov-2026: **reach it first; ignore it inline, with a
reason, only once research shows it cannot be reached.**

- Test every spot first: a module mock (`vi.mock` with a partial factory, one
  test file per mock so it affects no other test), a nullable or fake
  infrastructure object, or a stub at a boundary (the network, the clock, a
  child process, the DOM's layout).
- A spot still unreached after a real attempt is written up: its file, line
  and code; the condition it guards and when that happens in production; what
  was tried and why it failed; which techniques might work and were not tried.
  It then gets an issue and a research pass.
- Only a spot that has been through the write-up, the issue and the research
  pass, and still cannot be reached, is marked where it is:
  `/* v8 ignore next -- <why it cannot be reached> */` on the server,
  `/* istanbul ignore next -- <why> */` (or the `if`/`else` form) in the web
  app and shared packages. The reason says why the code cannot be reached, not
  that it is hard to test.
- Until then the caps stay counts: statements and branches at the measured
  number plus a margin of 5 where the count moves run to run, so CI stays
  honest. Once a measure's remaining spots are covered or marked, it is gated
  at 100%. Branches keep a shrinking count cap for code that is reachable and
  simply untested; they are not ignored.
- `pnpm check:coverage-ignores` (`tools/check-coverage-ignores.mjs`, run in
  CI's checks job) fails when a `v8 ignore`, `c8 ignore` or `istanbul ignore`
  comment in `apps/server/src`, `apps/web/src` or `packages/*/src` has no
  reason after `--`, and prints every ignore so a reviewer sees the list.

ADR 0012's test-quality rules and the existing file exclusions (the hosted
MotherDuck boundary, MySQL counted only where it runs) are unchanged.

### Consequences

- An ignore is the last step, never the first: each one has a write-up, an
  issue and a research pass behind it, and its reason sits beside the code.
- The check lists every ignore and fails CI on one without a reason.
- While caps remain counts, one newly covered item can still offset a new
  uncovered one; the caps shrink as spots are reached, and each measure moves
  to 100% once nothing is left in it.
