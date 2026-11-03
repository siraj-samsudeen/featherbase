# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. Local upload selection follows the existing instance/database boundary; the reset command is development-only. The approved isolation and legacy-preservation choices remain in this change's design. Hosted storage, database topology, app boundaries and coverage policy are unchanged.

## In-Force ADRs Reviewed

- ADRs 0005–0007 and 0009: Featherbase naming, React/Hono/Postgres stack, database topology and row identity remain unchanged. ADR 0006 supersedes the historical ADRs 0001–0004.
- ADRs 0010–0014, with the partial supersessions in ADRs 0015–0017 applied: OpenSpec remains the behavior contract; platform/app/instance boundaries and test-quality rules remain intact.
- ADR 0015: accepted ADRs remain immutable, and this issue stays in its own worktree and PR through archive.
- ADR 0017: coverage caps, inventories and exclusions are unchanged. Testing this reset does not authorize deleting existing developer data or relaxing a failing gate.

Highest sequence reviewed: 0017.

## New Durable ADRs Created

None. No major durable architectural decisions beyond the existing instance boundary were introduced, and no new repository-level ADR files were created.
