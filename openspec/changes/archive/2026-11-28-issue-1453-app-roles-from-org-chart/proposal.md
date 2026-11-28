## Why

An app's role was held only directly, or through another Role (App Role Binding). Forecasting is for everyone with a place on the org chart, hundreds of people decided by their jobs, and no Role matches that group, so the only route was granting it person by person, which new joiners never got (#1453).

## What Changes

- An app declares, under `orgChartRoles`, which of its roles everyone the org chart gives a place holds. "A place" is what the instance's one scope provider answers, the same places every scoped read keeps them to, so the app and its reads agree about who is in.
- The instance turns it on by enabling the Scheduled Job `sync_org_chart_roles` (off when installed). The job keeps App Roles From The Org Chart in step, daily and on Run Now: joiners get the role, and leavers and people with no place lose it.
- The Table says who holds which role and why (their places). System Managers read it; nobody edits it.
- While the job is off, nobody holds a role through it.

## Impact

`apps/server/migrations/0186_app_roles_from_org_chart.sql`, `org-chart-roles.ts`, `jobs/sync-org-chart-roles.ts`, `permissions.ts` (getRoles), `runtime-packages.ts`. Forecasting 0.15.0 declares Forecasting Member. Once the job runs on production, the App Role Binding Forecasting Member ← Dash Reader can go, on the owner's yes.
