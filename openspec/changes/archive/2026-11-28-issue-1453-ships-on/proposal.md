## Why

Siraj, 28-Nov-2026: it has to ship on.

## What Changes

- Installing an app, or upgrading to a version that first declares a role the org chart gives, turns that role on (writes its rule) and logs it; the upgrade preview lists it. A System Manager turns one off by removing its rule.

## Impact

`org-chart-roles.ts` (seedOrgChartRules), `apps.ts` (install), `runtime-packages.ts` (upgrade).
