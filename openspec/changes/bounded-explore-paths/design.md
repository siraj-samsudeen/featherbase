## Context

#786 supplies scoped direct-Reference membership in one PostgreSQL source. Explore has two fixed steps and no outgoing Reference mode. Siraj directs bounded five-Table paths and defaults, with no shortcut framework or routine design prompts.

## Goals / Non-Goals

Deliver four-edge explicit paths with exact membership and the existing UI. No HR report/dataset semantics (#785), router/title changes, source sums, cross-source joins, other engines, map redesign or arbitrary expressions.

## Decisions

1. Extend `related` with an optional `reference` naming the upstream Table's Reference back to the queried Table, applying only to `row_id`. Reject combining it with `via`/`column`/`parentfield`. Native and PostgreSQL compilers project that authorized Reference rather than the upstream primary key. Reject client-side ID shuttling: it truncates full-set membership and bypasses intermediate scope/column checks.
2. Reuse target scoping before projecting, validating that the Reference points to the queried Table and is readable/filterable. Preserve same-source identity and native/source refusal. Extend shared depth from three to four; keep sixteen compiled relationship specs per request. No generic execution planner.
3. Use an array of existing steps/selections and the existing three-column responsive grid. Extra cards wrap; there is no five-column redesign. Stage changes truncate successors; upstream selection changes clear all downstream selections. Forward steps still use scoped related predicates for selected IDs, never metadata values fetched from displayed rows.

## Risks / Trade-offs

- Hidden upstream Reference leakage → public HTTP denial tests for tiers/sensitive fields and row scopes.
- New nesting work → exact depth-four/five and breadth-sixteen/seventeen boundaries.
- Wrapping makes a long journey taller → retain familiar cards rather than invent a new navigation system.

## Migration Plan

No schema/data migration. Code-only deployment/rollback, neither authorized here.

## Open Questions

None requiring an owner choice. Ordinary hidden-logic review and independent UI verification remain required. Adversarial review is optional and not authorized.
