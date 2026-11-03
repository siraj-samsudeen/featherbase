# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. Neither design decision is a long-term architectural commitment beyond this
feature: that the list page keeps one filter per Choice column while the server stays unchanged, and that the list page
reads an older Choice `=` filter as `in` with that one choice. Each is recorded in this change's `design.md`.

## In-Force ADRs Reviewed

- 0005 naming-featherbase
- 0006 stack-react-hono-postgres
- 0007 app-and-database-topology
- 0009 record-identity-id-and-name
- 0010 openspec-change-workflow (its choice of schema superseded by ADR 0015)
- 0011 platform-app-instance
- 0012 coverage-targets-and-dead-code (backend thresholds superseded by ADR 0016)
- 0013 client-apps-and-product-apps
- 0014 one-repo-for-platform-and-apps (in part superseded by ADR 0015)
- 0015 adrs-are-never-edited
- 0016 backend-coverage-includes-branches (superseded by ADR 0017's non-regression baselines)
- 0017 backend-coverage-non-regression-baselines

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
