# ADR Review Manifest

- Status: completed for planning
- Review date: 2026-11-03

## Review Summary

ADR review completed for this change. The manager approved the stable internal Table identity and conservative legacy resolution for planning under reversible-default authority, not as an owner-reviewed ADR or authorization to implement.

The proposed internal navigation metadata is a localized implementation of immutable testimony versus mutable destination pointers, not a general identity framework. It changes neither the public row key nor Table metadata's natural primary key. No existing accepted ADR needs editing or supersession.

## In-Force ADRs Reviewed

- 0005: Featherbase naming.
- 0006: React, Hono and Postgres; no Frappe wire compatibility.
- 0007: control database and source boundaries, read together with 0011/0014's later app storage/layout decisions.
- 0009: `row_id`, Table registry natural-key exception, readable title versus identifier.
- 0010: OpenSpec authority; schema/process portions replaced by 0015.
- 0011: platform/app/instance boundaries, with 0013/0014 amendments.
- 0012: behavioral tests and measured coverage; backend gate portions superseded by 0016 and then 0017.
- 0013: client/product app distinction, with 0014 layout amendment.
- 0014: one repository, ordinary reviews and one-PR delivery; ADR mutability/schema portions superseded by 0015.
- 0015: immutable accepted ADRs, upstream schema, isolated worktrees.
- 0017: exact backend non-regression baselines; supersedes 0016's immediate gates. ADR 0016 was reviewed as superseded coverage history, not a current gate.

## New Durable ADRs Created

None. No major durable architectural decisions beyond existing metadata, transaction and history boundaries are introduced. No new repository-level ADR files were created. The internal navigation-only lifetime lookup is documented in this change's design rather than committing the platform to a universal identity mechanism. Open PR #818 already proposes ADR 0018; this change does not claim that number.
