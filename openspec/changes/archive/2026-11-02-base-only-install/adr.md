# ADR Review Manifest

- Status: completed for the draft design; owner review remains open
- Review date: 2026-11-01

## Review Summary

ADR review completed for this change. The design follows the existing
platform/app/instance boundary, package trust model and metadata-driven forms.
No major new durable architectural decisions are introduced and no new
repository-level ADR files were created. Revisiting trusted package execution
or introducing an external marketplace would require a separate decision.

## In-Force ADRs Reviewed

- 0005: Featherbase name.
- 0006: React, Hono and Postgres.
- 0007: database topology.
- 0009: record identity.
- 0010: behavior contract, excluding the schema choice superseded by 0015.
- 0011: platform/app/instance boundaries, as amended by 0013 and 0014.
- 0012: coverage and removal of unused code.
- 0013: client and product apps, as amended by 0014.
- 0014: repository and instance layout, excluding the editing/schema rules
  superseded by 0015.
- 0015: immutable accepted ADRs and worktree discipline.

## New Durable ADRs Created

- None.
