# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. Its decisions (a list leads with the title column, Row ID only without one; link titles resolved at the cell through the existing batched lookup; filter words derived when shown) are tactical UI choices. The "Row ID first" rule it reverses was a design decision of the #738 change (archived as `2026-10-31-list-columns-from-the-table`), not an ADR: that change's manifest recorded no new ADR, so no superseding ADR is needed. ADR 0009 (record identity) already settled that a row has an id and a name and that `title_column` names it; this change follows it.

## In-Force ADRs Reviewed

- ADR 0005, 0006, 0007, 0009, 0010, 0011, 0013, 0015 (supersedes 0014), 0017 (supersedes 0016, which superseded 0012)

## New Durable ADRs Created

- None - no major durable architectural decisions were introduced.
