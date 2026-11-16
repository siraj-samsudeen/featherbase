## Why

Some head-office staff need Dash's every-store view, as a Director's job gives it, without becoming System Managers and without a false job in HR. Reach comes only from a person's job, a scope provider cannot see roles, and an upgrade cannot add a role. Owner's decision, 11-Nov-2026: a Dash role that reaches every store, built as a platform change (#1192).

## What Changes

- A scope provider is told the person's roles, exactly as the platform resolves them for every other check, read fresh on each call.
- An upgrade creates each role its version newly declares and may give it its declared grants, also on Tables the app already had, only when the instance has no role of that name yet. A same-named role refuses the upgrade. The preview lists the roles it creates.
- Dash: a holder of Dash All-Stores Reader reaches every store, in addition to what their jobs reach, and holding the role alone opens Dash. Dash 0.12.11.

## Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: a scope provider learns the person's roles; an upgrade can add a role new to the instance.
- `dash-reports`: reach can also come from the Dash All-Stores Reader role.

## Impact

- Platform: `apps/server/src/person-scope.ts`, `apps/server/src/runtime-packages.ts`, the provider context type in `packages/shared`.
- Dash: its manifest, provider, server gate and a version step from 0.12.10.
