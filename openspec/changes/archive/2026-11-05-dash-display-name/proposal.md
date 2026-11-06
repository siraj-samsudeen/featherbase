## Why

The owner wants the app called "Dash", not "Feather Dash", "both in App name and in App switcher dropdown" (#966).

## What Changes

- People see "Dash" in the top bar's app name, the app switcher, the browser tab, Dash's own pages, the sign-in page and invitation emails on its instance, and its privacy notice.
- The role names and each Table's `module` say "Dash" too. The owner chose this because production is being installed fresh.
- The identifier `feather_dash` becomes `dash`: the route `/dash/`, Table names (`dash.store_rollout`), settings keys and the package name. The owner chose this for the same reason.
- Dash leaves `previousVersions`: an image holding the old versions would install a second app under the old name.
- Dash goes to 0.10.4 with an empty version step.

## Capabilities

### Modified Capabilities

- `app-navigation`: the switcher and the sidebar scenarios name the app Dash.
- `app-management`: the scenarios that inspect and configure the app name it Dash.
- `permissions-and-roles`: the store manager scenario names the app Dash.

## Impact

- `client-apps/jeyarama/dash` and its instance's settings and privacy notice.
- `INTERIM_APPS` in `packages/shared`, which names the app before it is installed, and the tests that read it.
- An instance that already has Dash installed cannot upgrade to this version: it must be wiped and installed fresh.
- An instance with an existing `app_name` or `MAIL_FROM` keeps it until its settings are applied or its variable is changed.
