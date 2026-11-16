## Why

Only a Report Access Manager can give Dash reports, and that role is company-wide: its holder sees every person and every grant and can give any report to anyone. A category head who only wants to give their own buyers a report must be handed that power, and then sees the whole company (#1217).

## What Changes

- A new Dash role, **Team Report Manager**. Its holder manages report access for their team only: the people whose current Job Assignment reports to them.
- They give only reports they can open themselves, and bundles whose every report they can open; only to a person in their team; never to themselves, a role or a job. They take away only grants they gave to someone in their team. They make no bundles.
- The Report access page narrows for them: the person picker lists their team, "Who has what" lists their team's grants, and the bundle tools and waiting list are hidden.
- Their writes to the access Table are accepted only from Dash's own give and remove actions, so the Table permission the role needs can't be used to skip the team checks.
- Platform: an app's save rule is told the writer's roles.
- The Report Access Manager is unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities

- `report-access`: a team-scoped way to give reports.
- `trusted-runtime-packages`: a save rule sees the writer's roles.

## Impact

- Dash: `team-access.ts` (new), `report-access-server.ts`, `server.ts`, `access-page.tsx`, the manifest's role, grants and version step. A new Dash version.
- Platform: `runtime-packages.ts` passes `roles` to app validators.
