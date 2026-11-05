## Why

The owner wants the app called "Dash", not "Feather Dash", "both in App name and in App switcher dropdown" (#966).

## What Changes

- People see "Dash" in the top bar's app name, the app switcher, the browser tab, Dash's own pages, the sign-in page and invitation emails on its instance, and its privacy notice.
- The identifier `feather_dash`, its route, Tables and permissions stay. So do the role names and each Table's `module`.
- Dash goes to 0.10.4 with an empty version step.

## Capabilities

### Modified Capabilities

- `app-navigation`: the switcher and the sidebar scenarios name the app Dash.
- `app-management`: the scenarios that inspect and configure the app name it Dash.
- `permissions-and-roles`: the store manager scenario names the app Dash.

## Impact

- `client-apps/jeyarama/dash` and its instance's settings and privacy notice.
- `INTERIM_APPS` in `packages/shared`, which names the app before it is installed, and the tests that read it.
- An instance with an existing `app_name` or `MAIL_FROM` keeps it until its settings are applied or its variable is changed.
