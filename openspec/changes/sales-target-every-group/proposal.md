# Proposal

## Why

A reader's Sections list every material group the store's merchandise map gives them (JeyaramaGroup/data-warehouse#4344). The cached report took each group's name and its sales from the store's target rows, and the warehouse has target rows only where a target was set. A group with no target this month therefore read "(name not in hierarchy)" with "no actuals", even when it sold. The groups are all in the hierarchy; the join was wrong. Many such groups are never traded at the store, so showing all of them would also bury the figures.

## What Changes

- Every group's name comes from the merchandise hierarchy, keyed by material group code.
- Actuals come from every sale of the store × group × month, target or not. A group with a target keeps the target's own actual, so a store's figures for its targeted groups do not move. A group with no target reads a ₹0 target.
- A group with ₹0 target and ₹0 sales this month is classed "no target, no sale". It is hidden by default behind a "Show groups with no target or sales" toggle. It adds ₹0, so every subtotal and the total read the same either way.
- The snapshot stores the hierarchy's names beside its day rows; its definition revision moves to 2, so the next refresh rebuilds it. The day rows' old name column stays for this release, unwritten, so the previous build and a rollback keep working; #447 drops it.
- A month with no targets in the warehouse is never shown as ₹0 targets: a refresh from it is refused, and a live read leaves targets blank and says so.

## Capabilities

### Modified Capabilities

- `sales-target-report`: every listed group is named and counted (change `sales-target-section-scope`).

## Impact

- `apps/server/src/datasets/sales-target-mtd.ts`, `apps/server/src/sales-target-report.ts`, `apps/web/src/pages/SalesTarget.tsx`; migration `0110_sales_target_snapshot_name.sql`.
- The live MotherDuck Dive is not changed. A target set above material group (Food Court's line-of-business target) still does not reach a Section; that is options 2 and 3 of #4344.
