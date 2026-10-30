# ADR 0012: Full server coverage, merged web coverage, and dead code goes

**Status:** Accepted · **Date:** 2026-10-26 · **Corrected:** 30-Oct-2026 (#705) · **PR:** [#504](https://github.com/siraj-samsudeen/featherbase/pull/504)

> **30-Oct-2026 correction.** The server's line and statement gates sit at
> **99.5**, not 100; functions are at 100 and branches at 90. The gap is
> release-preflight's PostgreSQL 18 checks, which run in CI's separate
> `release-preflight-pg18` job rather than in the shards that enforce the
> floor. `apps/server/vitest.config.ts` holds the numbers and `docs/TESTING.md`
> describes how they are enforced; both win over the figures below.

## Context

On 26-Oct-2026 the owner asked for specs and tests that cover the whole of
the current code before production, and for unused and unreachable code to
be removed. Server coverage stood near 87% of lines. Web coverage stood near
33%, because many screens are proven only by Playwright, which the jsdom
suite cannot count. The strategy below was set with a second model's review
and adopted by the coordinating agent; the owner delegated the call.

## Decision

**Server: 100% of lines, statements and functions.** Branch coverage is
reported, not gated; its floor is set to the first merged CI figure and only
rises. The merged CI run is the number of record, because only CI has every
service the suite needs (MySQL among them).

- Code that runs as its own process (the command line, release, migrate)
  exposes an in-process `main(argv)`; tests call it directly, and one
  subprocess test per entry point proves the entry guard fires.
- A coverage ignore is allowed only for an entry-point guard, an operating
  system or driver failure that cannot be produced without mocks (which this
  project does not use), or a type-exhaustiveness default. It must read
  `/* v8 ignore next N -- <reason>; <why no test can reach it> */`.
  Network-only calls to a hosted service sit behind one listed coverage
  exclude, not scattered ignores.
- Anything else no test can reach through a real caller is deleted, not
  ignored.
- Every new test drives behaviour through HTTP or an exported function and
  asserts an observable outcome: a status and body, or a stored row. A test
  whose only assertion is that something is defined, or did not throw, does
  not count.

**Web: one merged report.** The Playwright run and the jsdom run both
produce Istanbul coverage, which is merged into one report; component tests
are written only for what the merged report shows uncovered, so they do not
repeat what a browser test already proves. Instrumentation is switched on by
an environment variable, so the ordinary dev server, `./init.sh` and
production builds are unchanged.

**Dead code.** After coverage is full: unused files and dependencies go
first, then exports used only inside their own file are made private, then
the lines the coverage work listed as unreachable are deleted. Each batch
passes typecheck, both suites and the smoke test before the next starts.

## Consequences

The server thresholds in `apps/server/vitest.config.ts` rise to 100 for
lines, statements and functions *(corrected 30-Oct-2026: lines and statements
settled at 99.5, see the note above)*. A refactor of the release path lands in the
same change set as its tests; it touches the deploy path, so it is called out
in the pull request for review before a release uses it.
