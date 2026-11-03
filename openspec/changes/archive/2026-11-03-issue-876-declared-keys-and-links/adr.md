# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. Declaring a key and links in an app's table settings extends #808's per-table settings inside the same data-source boundaries (ADR 0006/0007): reflect still connects read-only, the source's own declarations still decide where they exist, and the warehouse app names an environment variable, never a connection string (ADR 0013/0014). The agree-or-refuse rule and the sibling warehouse app are tactical.

## In-Force ADRs Reviewed

- ADR 0005, 0006, 0007, 0009, 0010, 0011, 0013, 0014, 0015, 0017

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
