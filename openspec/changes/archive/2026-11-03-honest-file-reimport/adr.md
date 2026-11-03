# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. The generic import preview is extended inside its existing ownership boundaries; no major durable architectural decisions were introduced and no new repository-level ADR files were created.

## In-Force ADRs Reviewed

- 0005: Featherbase naming.
- 0006: React/Hono/Postgres, superseding the deleted Convex decisions 0001–0004.
- 0007: native and external data boundaries; this change does not import into bound tables.
- 0009: row identity and explicit import mapping.
- 0010: OpenSpec behavior authority, with schema/workflow amendments from 0014/0015.
- 0011 and 0013: platform/app/instance and client/product boundaries, as amended by 0014.
- 0012: HTTP-based test quality and frontend coverage; backend gates are superseded by 0016 then 0017.
- 0014: repository boundaries and one change/PR, excluding its editable-ADR/schema decisions superseded by 0015.
- 0015: immutable accepted ADRs and issue worktrees.
- 0017: exact backend non-regression baselines, superseding 0016's immediate 100% gates.

Highest sequence reviewed: 0017. Prior ADRs were not edited.

## New Durable ADRs Created

None.
