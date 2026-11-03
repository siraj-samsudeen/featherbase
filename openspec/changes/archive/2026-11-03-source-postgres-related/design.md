## Context

Unchanged HTTP/browser reproduction confirms source dispatch rejects `related`. Native compilation intentionally refuses bound targets; source drivers have only scalar predicates. The manager explicitly authorized the bounded implementation after read-only discovery, removing routine approval waits.

## Goals / Non-Goals

Repair direct Reference Explore chains within one PostgreSQL Data Source record. Do not support cross-source/native-bound, parent/via, MotherDuck or other engines. No UI redesign, migration, client ID shuttling or widening of literal selected-row reads.

## Decisions

1. Push relationship membership into PostgreSQL subqueries. Reject materializing upstream IDs: it truncates at list limits or adds unbounded transfer and inconsistent count semantics. Reuse a typed, validated recursive predicate for list/count/group reads.
2. Authorize and scope every binding before execution. Require the same Data Source row identity, not equivalent credentials/URLs; use existing binding guards and the vetted source pool. Scope filters use the full binding before caller tiers narrow fields. Bound `own_rows` remains denied. Share parsing and depth/hop budgets with native queries without changing native execution.
3. Keep native-bound and unsupported shape/engine guards. A general federated query mechanism is a different change; silently broadening the operator across drivers would lose constraints. SQL NULL membership remains distinct from NULL-passes Data Scope rules.

## Risks / Trade-offs

- Nested authorization omission → asymmetric public tests deny an intermediate hop and scope each level.
- SQL alias/parameter collision → nested/self-reference and sibling predicate tests exercise distinct values.
- Source changes elsewhere → confine #787 overlap to non-introspection predicate construction; preserve additive #805 source types if later integrated.

## Migration Plan

No data migration. Deploy/revert application code normally, only with owner authorization.

## Open Questions

None for this approved scope. Adversarial review is not authorized. Ordinary review remains required.
