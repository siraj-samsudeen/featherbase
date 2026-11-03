# ADR 0017: Gate backend coverage on exact non-regression baselines

**Status:** Accepted · **Date:** 2026-11-02 · **Supersedes:** [ADR 0016](0016-backend-coverage-includes-branches.md)'s immediate 100% gates · **Issue:** [#762](https://github.com/siraj-samsudeen/featherbase/issues/762)

## Context and Problem Statement

The owner stopped further coverage expansion and explicitly chose
non-regression baselines while keeping all measured code. The fresh reports
from [CI run 41391014265](https://github.com/siraj-samsudeen/featherbase/actions/runs/41391014265)
at `9a65d35f6b6bd990c453da688526431d95da01ef` establish the baseline.
Core merges three server shards and the PostgreSQL 18 preflight, with MySQL
enabled; Dash merges its source-compatible unit and platform profiles.
Tests pass, but the unfinished 100% gates reject those reports.

## Considered Options

- Keep immediate 100% gates and override each merge: retains red checks even
  when coverage has not regressed.
- Exclude uncovered code: hides measured gaps and violates the owner's choice.
- Use percentage floors: rounding can conceal an additional uncovered item.
- Cap exact uncovered counts: permits the measured checkpoint and rejects
  additional gaps without removing code from the denominator.

## Decision Outcome

Use maximum uncovered counts for all four backend metrics:

| Scope | Statements | Branch arms | Functions | Lines |
| --- | ---: | ---: | ---: | ---: |
| Core | 232 | 870 | 22 | 25 |
| Dash | 2 | 17 | 2 | 0 |
| Tasker | 0 | 0 | 0 | 0 |

The corresponding fresh covered/total counts are core 14119/14351 statements,
10604/11474 branch arms, 2778/2800 functions and 11868/11893 lines; Dash
611/613 statements, 431/448 branch arms, 186/188 functions and 455/455 lines.
Tasker's existing 100% gates remain unchanged.

Core uses Vitest's negative thresholds (maximum uncovered counts); Dash checks
the counts in its merger. Keep all measured sources, existing exclusions,
inline directives, source-inventory checks and map/counter validation unchanged.
No new exclusions or ignores are authorized. Tighten caps as coverage improves;
raising a cap requires another explicit owner decision. Frontend policy and
ADR 0012's test-quality rules remain unchanged. The goal remains 100%.

### Consequences

- Coverage can pass honestly without claiming 100% or bypassing functional
  failures. One additional uncovered item beyond any cap fails the gate.
- These are aggregate gap budgets, not per-location protection: covering one
  item can offset uncovering another. Source growth fully covered by tests is
  allowed. Scope integrity still depends on the existing inventory checks and
  review of configuration changes.
- A passing measured report does not prove excluded hosted MotherDuck behavior
  or other unmeasured processes. The remaining gaps stay visible in reports
  and issue #762; this decision does not complete that coverage work.
