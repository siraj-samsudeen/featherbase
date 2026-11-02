# ADR 0016: Enforce full backend coverage including branches now

**Status:** Accepted · **Date:** 2026-11-01 · **Supersedes:** [ADR 0012](0012-coverage-targets-and-dead-code.md)'s backend thresholds and branch-ratchet policy · **Issue:** [#747](https://github.com/siraj-samsudeen/featherbase/issues/747)

## Context

The owner explicitly requires 100% backend coverage, including branches,
now, not only after the remaining coverage work is complete. The prior 90%
platform branch gate and Tasker's unenforced backend branch count do not
implement that policy. Frontend coverage strives for 100%; genuine exceptions
must be proposed to and approved by the owner.

## Decision

Enforce 100% statements, functions, lines and branches for the platform
backend. Retain Tasker's merged 100% statement, function and line gates and
enforce 100% branches for its owned source in the esbuild server-entry import
closure. Frontend branches remain a separate goal, not part of that backend
gate. No new exclusions or inline ignore directives are authorized.

Platform measurement remains the configured server source scope, with its
existing exclusions and inline directives; CI merges the shards and PG18
release checks with MySQL enabled. Tasker uses its source-matched five-layer
Istanbul report, not platform V8 counters. Dash backend profiles have different
remapping and are not yet mergeable; no misleading combined gate or claim is
made for them. Existing ADR 0012 test-quality rules remain in force.

## Consequences

The gates can and must fail while coverage work is unfinished. A passing
scoped report is not proof of coverage for excluded boundaries, other apps,
or unmeasured runtime processes. This policy does not claim 100% achieved.

## Options considered

Keeping 90% branches until the report reaches 100%, or merely reporting
backend branches, was rejected because either delays the owner's explicit
gate. Adding exclusions to make it green was not authorized.
