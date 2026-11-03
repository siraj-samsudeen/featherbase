# ADR Review Manifest

- Status: completed
- Review date: 2026-11-02

## Review Summary

ADR review completed for this change. The one design decision (read Postgres primary keys from `pg_constraint`) is a tactical detail inside the Postgres driver; it sets no pattern, boundary or contract beyond this change.

## In-Force ADRs Reviewed

- ADR 0005 Naming Featherbase
- ADR 0006 Stack: React, Hono, Postgres
- ADR 0007 App and database topology (a data source never reaches the platform's own database: unchanged)
- ADR 0009 Record identity: id and name
- ADR 0010 OpenSpec change workflow
- ADR 0011 Platform, app, instance
- ADR 0013 Client apps and product apps
- ADR 0015 ADRs are never edited (supersedes ADR 0014)
- ADR 0017 Backend coverage non-regression baselines (supersedes ADR 0016, which superseded ADR 0012)

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
