## Why

Explore fails to load connected floors until a store is selected (#786). Users need the downstream pane to follow the whole readable upstream set, not just a displayed page.

## What Changes

- Support direct Reference relationship filters between Tables bound to the same PostgreSQL Data Source record, including nested chains.
- Preserve permissions, tiers, Data Scope, source allowlists and platform isolation at every hop; preserve explicit refusal of other source/relationship shapes.
- Keep the existing Explore controls and selected-row filters unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: follow connected PostgreSQL relationships over the complete readable upstream set.

## Impact

Source dispatch, PostgreSQL predicates and shared relationship syntax/budgets. Public HTTP regressions and real source-backed browser acceptance. No migration or dependency. No changes to #787 primary-key introspection, #788 reflection/titles, #789 Explore UI or #805 MotherDuck.
