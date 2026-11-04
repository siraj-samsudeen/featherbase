# ADR Review Manifest

- Status: completed
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. The highest existing sequence is 0017.
No major durable architectural decisions were introduced and no new
repository-level ADR files were created. The design applies existing app
boundaries and transaction/permission contracts to Tickets.

## In-Force ADRs Reviewed

- 0005: Featherbase naming.
- 0006: React, Hono and Postgres; supersedes deleted ADRs 0001–0004.
- 0007: One control database; source dispatch is per connected table.
- 0009: Record identity and standard column conventions.
- 0010: OpenSpec as the behavior contract; later schema/process provisions
  are governed by 0014 and 0015.
- 0011: Platform, **App**, **Instance**; amended by 0013 and 0014.
- 0012: Test quality and frontend coverage; backend gates now follow 0017.
- 0013: **Product app** versus client app; locations amended by 0014.
- 0014: One repository, instance configuration and delivery; mutable ADR and
  schema/worktree provisions are superseded by 0015.
- 0015: Immutable accepted ADRs, shared schema and one worktree per issue.
- 0017: Exact backend non-regression baselines; supersedes 0016's immediate
  100% gates. 0016 was reviewed as historical context, not a live gate.

Partial supersessions above replace only the named provisions, not unrelated
decisions in the older ADRs. Accepted ADR files remain untouched.

## New Durable ADRs Created

- None — no major durable architectural decisions were introduced.
