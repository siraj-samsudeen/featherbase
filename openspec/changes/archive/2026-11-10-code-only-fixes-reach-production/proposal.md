## Why

Production follows `main` and takes 50–100 small fixes a day (#1178, D3). Today a fix to an app's
code that leaves its tables alone still needs a new version number before production accepts it,
while dev takes it straight away. The version bump protects nothing: the data is untouched, and the
commit already records what production runs.

## What Changes

- A production deploy takes an app's changed files under the same version, as dev does, as long as
  the app's declaration (`featherbase.json`) is unchanged. A changed declaration still needs a new
  version and a migration.
- `check:app-digests` and its workflow go: they existed only to warn that production would refuse
  such a change.

## Capabilities

### Modified Capabilities

- `running-an-instance`: a code-only fix reaches production without a new version.

## Impact

- `apps/server/src/deploy-instance.ts`, its tests, `docs/DEPLOY.md`.
- `tools/check-app-digests.mjs`, its test, `.github/workflows/app-digests.yml`, `package.json`.
