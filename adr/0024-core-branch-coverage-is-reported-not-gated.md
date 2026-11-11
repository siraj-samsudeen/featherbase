# ADR 0024: Core branch coverage is reported, not gated

**Status:** Accepted · **Date:** 2026-11-11 · **Supersedes in part:** [ADR 0017](0017-backend-coverage-non-regression-baselines.md)'s branch-arm cap for core, and [ADR 0023](0023-coverage-ignores-at-the-unreachable-spot.md)'s rule that branches keep a shrinking count cap

## Context and Problem Statement

ADR 0017 caps the uncovered count of each coverage measure, and ADR 0023 keeps
a shrinking count cap on branches until they reach 100%. After the coverage
passes, the core server and web suites cover every line and function, web
covers every statement, and the server leaves one statement. Branches were
capped at 246 uncovered (server) and 411 (web).

The branch cap is an aggregate count, and that count is not stable for the
same code:

- CI's merged web shards count about 6 more uncovered branches than a local
  run of the same commit (505 locally was 511 in CI; 400 was 406).
- It moves by a few between CI runs of the same commit, because component
  tests take different render branches from run to run.

Main went red three times on the branch cap with no code at fault: 620
against a cap of 618, 511 against 510, and 406 against 405. Each time the fix
was to raise the cap or re-run, which is the work a gate is meant to save.

What the cap protects is small. Lines, statements and functions are at or
next to 100%, so new code without tests already fails those gates. The branch
cap is an aggregate budget, so covering one branch makes room for a new
uncovered one; it never said which branch was missing.

This does not mean the remaining branches are unreachable. Most of them are
reachable and simply untested yet (ImportWizard, FormView, LinkControl,
ListView, AdminLayout and ListRows lead on web), and a few have been tried and
not reached yet, as the pass 3 report describes.

## Considered Options

- Keep the caps with a bigger margin: still breaks when the drift outgrows the
  margin, and a big margin lets real regressions through as well.
- Ignore the remaining branches inline: they are mostly reachable, and ADR
  0023 allows an ignore only after research shows a spot cannot be reached.
- Remove the branch gate from the core configs and keep the numbers in the
  reports.

## Decision Outcome

Chosen by the owner on 11-Nov-2026: **core branch coverage is reported, not
gated.**

- `apps/server/vitest.config.ts` and `apps/web/vitest.config.ts` set no
  `branches` threshold. Lines and functions stay at 100, web statements at
  100, and the server's statement cap stays a count of 1.
- The branch column still prints in every coverage report, locally and in CI.
  CI keeps the merged server summary (`server-coverage`) and the merged web
  report (`merged-source-coverage`) as artifacts.
- The coverage jobs still fail on a failing test or a missing shard report.
- Dash's and Tasker's coverage gates are unchanged; ADR 0017 still governs
  them.
- ADR 0023 still governs ignores for every measure: no ignore without the
  write-up, the issue and the research pass, and branches are not ignored to
  make a number look better. Its count caps still apply to the server's
  statements.

### Consequences

- Main no longer goes red on branch drift that no commit caused.
- A change that leaves new branches untested no longer fails CI. Reviewers
  and the reports have to catch it, as they do for test quality generally.
- The goal stays 100% branches; this decision does not claim the remaining
  branches cannot be reached. A branch gate can come back once the count is
  stable, for example at 100% or per file.
