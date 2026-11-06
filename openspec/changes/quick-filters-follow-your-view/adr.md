# ADR Review Manifest

- Status: completed
- Review date: 2026-11-02

## Review Summary

ADR review completed for this change. Neither design decision is a long-term architectural commitment beyond this
feature: how the server reads a Yes/No filter value, and that a Yes/No filter's address value works like a Choice
filter's. Each is recorded in this change's `design.md`.

This change was written with `WHEN/THEN` scenarios and hand-written tests because OpenSpec 1.16.0 under `--strict`
rejected fenced Gherkin in a change, against ADR 0014. Main fixed that on 02-Nov-2026 (`e242b647` patches the pinned
parser), so the conflict with ADR 0014 no longer exists.

## In-Force ADRs Reviewed

- 0005 naming-featherbase
- 0006 stack-react-hono-postgres
- 0007 app-and-database-topology
- 0009 record-identity-id-and-name
- 0010 openspec-change-workflow
- 0011 platform-app-instance
- 0012 coverage-targets-and-dead-code (backend thresholds superseded by ADR 0016)
- 0013 client-apps-and-product-apps
- 0014 one-repo-for-platform-and-apps
- 0015 adrs-are-never-edited
- 0016 backend-coverage-includes-branches (superseded by ADR 0017's non-regression baselines)
- 0017 backend-coverage-non-regression-baselines

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
