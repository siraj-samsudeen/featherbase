## Why

Dash is moving to opening any Dive, so someone has to decide who sees which report. Today that needs a developer. The business owner should be able to give a person, a role or a job one report or a named group of reports, on a screen, see who has what, and take it away.

## What Changes

- New Dash Tables `dash.report_bundle`, `dash.report_bundle_member` and `dash.report_access`, next to `dash.report`. One access row gives one report or one bundle to one person, role or job.
- A person sees the union of what reaches them by any route, read fresh on every request. No row means no report, for everyone, System Managers included. Nothing withholds and nothing has dates.
- A Report Access Manager role writes only those Tables, so the owner needn't be a System Manager. Every change is in version history.
- Dash gains the check `reportsGivenTo`, a refusal when opening a report outside the list, and a Report access page: give, who has what, remove, and a person lookup that says why.
- Dash opens only for someone with a report, or who manages access. Anyone else gets the existing no-access page, which records an Access Request. Report Access Managers are alerted, and the request clears once a report reaches them.

## Capabilities

### New Capabilities

- `report-access`: who may see which report, how it is given and removed, and how a person asks.

### Modified Capabilities

- `permissions-and-roles`: records an app's own assignment Tables as outside "only a System Manager changes who can do what".
- `trusted-runtime-packages`: an app can add its own check to who opens it, and name approver roles.

## Impact

- New files in Dash (now in the client's repository), plus wiring in its manifest, server and app, on top of #967's rewrite. A new Dash version.
- The Tables, the role and its grants ship in Dash's manifest and version step.
- The first bundles and assignments go to the owner as a CSV before they are loaded, and load in the same release as the check.
- Platform: an app can add its own check to its gate, and the Access Request alert and waiting list reach an app's approver role.
