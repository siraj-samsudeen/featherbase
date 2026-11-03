# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. A nested-row grid reuses the form's existing link picker; the
metadata-driven form (architecture invariant 3: one generic form view) stays generic, with no per-Table
control. The conditional design document is omitted: no new boundary, contract, data model, migration or
security policy is introduced, and the server's existing link validation is unchanged.

## In-Force ADRs Reviewed

- ADR 0005-0007 and 0009: naming, React stack, database topology and row identity remain unchanged.
- ADR 0011-0014: platform and app boundaries are untouched.
- ADR 0015-0017: no ADR file is edited; no coverage policy changes.

## New Durable ADRs Created

None. No major durable architectural decisions were introduced and no new repository-level ADR files were
created.
