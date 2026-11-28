## Why

Fable review of #1453: one instance-wide switch let an upgrade add a role from the org chart unseen; a same-named role an app only adopted could be given; and a provider outage emptied the holders.

## What Changes

- Each role is turned on by its own Org Chart Role Rule row, a security Table a System Manager edits. An upgrade lists roles it adds or removes in its preview, and none is given until its rule exists.
- Only a role the app created when it was installed is given.
- A run the scope provider cannot answer writes nothing and fails; the last holders stand.

## Impact

`migrations/0186_app_roles_from_org_chart.sql`, `org-chart-roles.ts`, `permissions.ts`, `security-tables.ts`, `access-explanation.ts`, `runtime-packages.ts`.
