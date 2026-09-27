# Design boundary — Gate 1 only

## Context

This is an empty-history benchmark branch with only OpenSpec tooling and planning artifacts. See proposal.md for scope and specs/todo/spec.md for the proposed behavior. No candidate application exists.

## Goals / Non-Goals

**Goal:** Agree on observable release-1 outcomes before designing the evaluation or implementing any candidate.

**Non-goals:** Choosing application architecture, implementing a suite, launching workers, or deploying anything at Gate 1.

## Decisions

The product spec deliberately leaves routes, envelopes, libraries, rendering strategy, and internal organization open. OpenAPI is proposed only as the external machine-readable contract. Rejecting stale writes is proposed rather than automatic merging so concurrent changes cannot silently discard a user's intent. Unicode code points define title length consistently across language runtimes.

The owner must approve Gate 1 before the manager proposes Gate 2's rubric and acceptance design. That design requires its own approval before Gate 3 suite implementation. Gate 3 approval is required before any candidate worker starts. An OpenSpec status of complete means artifact presence, not approval or permission to implement.

## Risks / Trade-offs

- Ambiguous response loss requires more than retaining a draft → specify the user-visible no-duplicate recovery outcome without dictating its mechanism.
- A single record's concurrency boundary rejects non-overlapping stale changes → make the rejection explicit and preserve input for deliberate retry.
- OpenAPI capabilities differ by framework → record any contract-generation friction in the later comparison; do not prescribe generation libraries.
- Automated accessibility checks cannot establish complete screen-reader usability → Gate 2 must distinguish automated evidence from manual validation and remaining limitations.

## Migration Plan

No database exists at this gate and no migration will run. The product spec defines initialization, preservation, failure, retry, and concurrency outcomes. Candidate-specific migration implementation belongs to the later authorized worker phase; incremental Projects rollout and rollback belong to Gate 5.
