# ADR Review Manifest

- Status: completed
- Review date: 2026-10-31

## Review Summary

ADR review completed for this change. None of the three design decisions is a long-term
architectural commitment beyond this feature: a user's list view stored as changes on top of
the Table's default, the caller's readable levels added to the `:meta` response, and list
choices saved in the Table's definition (clearing that column's `in_list_view` override). Each
is local to the list and recorded in this change's `design.md`.

One in-force ADR no longer matched the process after this change's `config:` commit and was
corrected in place (ADR 0014 is not append-only): ADR 0014's OpenSpec section said acceptance
tests come first only in autopilot; it now says every mode writes Gherkin scenarios that
cucumber-js runs.

## In-Force ADRs Reviewed

- 0005 naming-featherbase
- 0006 stack-react-hono-postgres
- 0007 app-and-database-topology
- 0009 record-identity-id-and-name
- 0010 openspec-change-workflow
- 0011 platform-app-instance
- 0012 coverage-targets-and-dead-code
- 0013 client-apps-and-product-apps
- 0014 one-repo-for-platform-and-apps (corrected, OpenSpec modes)

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
