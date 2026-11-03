# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. A client app declaring a connection to the client's own system is already allowed: ADR 0013 and ADR 0014 place client apps and their instances in this repository with client data and secrets kept out, and app-declared data sources (EDS/M3) name an environment variable, never a connection string. The per-table settings, skipping left-out columns at connect, refusing unknown columns and the manifest-only app shape are tactical and stay inside ADR 0006/0007's data-source boundaries.

## In-Force ADRs Reviewed

- ADR 0005, 0006, 0007, 0009, 0010, 0011, 0013, 0014, 0015, 0017

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
