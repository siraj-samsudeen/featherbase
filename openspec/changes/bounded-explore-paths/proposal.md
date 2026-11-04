## Why

Explore stops before users can follow everyday questions through five linked Tables (#781). Following a link toward its referenced row is also missing from Explore, even though the relationship map supports walking to that row.

## What Changes

- Extend explicit Explore paths to a starting Table and four more, including forward References.
- Keep the existing cards, selectors and Peek; additional cards wrap in the existing grid.
- Extend scoped relationship membership to project an upstream Reference, with four levels and the existing sixteen-hop budget.
- Preserve whole-set filtering, deduplicated endpoint rows, downstream selection clearing and stale-link prefix recovery.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `search-and-explore`: five-Table paths in both Reference directions.
- `external-data-sources`: forward relationship membership within one PostgreSQL Data Source.

## Impact

Explore state, step discovery/parser, shared relationship syntax and native/PostgreSQL compilers. No migrations, shortcut definitions, source sums, cross-source execution or HR reporting rules. #786's merged foundation is reused. Separately owned #785 reporting and title/presentation PRs are not taken over. Siraj explicitly directed implementation using defaults; no routine design-choice wait.
