## Why

A client's apps are leaving this repository (#1197, phase 2 of #1178). Two platform specs still
promise their behaviour through one client app, Dash, so their tests need that app's code to run.
Once the client's folder is gone, those promises would have no test. Naming a test app instead
keeps every promise and lets the platform prove it on its own.

## What Changes

- The app navigation promises name Store Reports, a test app with a store picker, in place of
  Dash. The promises are unchanged: the application choice offers only what the user can open,
  and an app's store selection survives following its own navigation.
- The app management promises name Warehouse, a test client app with two settings and a required
  secret, in place of Dash. The promises are unchanged: an unbuilt client app can be inspected
  without being installed, a file-managed setting stays locked, and a missing secret is shown by
  name only.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app-navigation`: the scenarios name Store Reports instead of Dash.
- `app-management`: the scenarios name Warehouse instead of Dash.

## Impact

- Two small test apps under `test-apps/fixtures/`. No product code changes.
- Other platform specs that mention Dash (permissions-and-roles, sign-in-and-accounts,
  tables-and-fields) are not reworded here: their tests already run on test apps, not on the
  client's code.
