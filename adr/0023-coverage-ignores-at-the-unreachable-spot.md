# ADR 0023: Coverage ignores sit at the unreachable spot, with a reason

**Status:** Accepted · **Date:** 2026-11-10 · **Supersedes in part:** [ADR 0017](0017-backend-coverage-non-regression-baselines.md)'s "no new exclusions or ignores" rule, for code no test can reach

## Context and Problem Statement

ADR 0017 caps the uncovered count of each coverage measure and allows no new
ignores. A cap is an aggregate budget: covering one item makes room for a new
uncovered one, so a gap can move unnoticed while the number stays the same.
After the branch-coverage passes, lines and functions are fully covered and
only a handful of statements are left. Most of those guarded "a row deleted or
changed in between" windows, which turned out to be reachable: a module mock
in a test file of its own holds the window open. What is left is code no test
can reach, named in prose in each Vitest config, far from the code itself.

## Considered Options

- Keep a negative cap for every measure, with the exceptions named in the
  config comment: a new uncovered item can still offset a newly covered one,
  and the prose drifts from the code.
- Exclude whole files: hides reachable code with the unreachable.
- Ignore the unreachable spot inline, with the reason beside it, and hold
  lines, statements and functions at 100%.

## Decision Outcome

Chosen by the owner on 10-Nov-2026: **ignore inline, with a reason, and only
when no test can reach the code.**

- Test it first, with a module mock where the code waits on another module
  (`vi.mock` with a partial factory, one test file per mock, so it affects no
  other test).
- Code no test can reach is marked where it is:
  `/* v8 ignore next -- <why it cannot be reached> */` on the server,
  `/* istanbul ignore next -- <why> */` (or the `if`/`else` form) in the web
  app and shared packages. The reason says why the code cannot be reached, not
  that it is hard to test.
- Lines, statements and functions are gated at 100% in both Vitest configs.
  The config comments point to the inline marks instead of listing exceptions.
- Branches keep a count cap, the measured count plus 5, because most of the
  branches left are reachable and simply untested. Only a branch that truly
  cannot be reached is marked inline; the cap counts the rest and shrinks as
  they are tested.
- `pnpm check:coverage-ignores` (`tools/check-coverage-ignores.mjs`, run in
  CI's checks job) fails when a `v8 ignore`, `c8 ignore` or `istanbul ignore`
  comment in `apps/server/src`, `apps/web/src` or `packages/*/src` has no
  reason after `--`, and prints every ignore so a reviewer sees the list.

ADR 0012's test-quality rules and the existing file exclusions (the hosted
MotherDuck boundary, MySQL counted only where it runs) are unchanged.

### Consequences

- A newly uncovered line, statement or function fails at once; it cannot hide
  behind one covered elsewhere.
- Each ignore is reviewed where it sits, with its reason, and listed by the
  check. An ignore without a reason fails CI.
- The branch cap still allows one newly covered branch to offset a new
  uncovered one until it reaches zero; that is the remaining gap of this
  decision.
