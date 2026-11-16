## Why

A two-line fix takes about five minutes to reach production. On 10-Nov-2026 a production deploy
of Dash spent 3 min 26 s of its 5 min 18 s rebuilding the 20 old app versions listed in the
instance's `instance.json`, which never change. They are there only so that an upgrade can read
the version it moves from. The database already records that version's declaration when the app
is installed, so the upgrade can read it from there and the old files can go.

## What Changes

- An upgrade reads the installed version's declaration (its Tables, grants, jobs and package name)
  from the app's installed record instead of from that version's files on the server.
- The checks before a deploy accept an installed version that the release doesn't ship when the
  release ships a newer version of the same app: the deploy step upgrades it.
- `previousVersions` goes from `instance.json`, the build no longer downloads and rebuilds old
  versions, and the Dockerfile's old Tickets stages go.

Unchanged: the new version's files are still checked against their fingerprint, an installed
version is still the only one the running server serves, and an app whose installed version isn't
shipped and has no newer version shipped is still refused.

## Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: an upgrade needs only the new version; the image no longer ships the
  installed predecessor.

## Impact

- `apps/server/src/runtime-packages.ts` (upgrade plan), `release-preflight.ts`,
  `deploy-instance.ts`.
- `tools/build-instance-apps.mjs`, `apps/server/Dockerfile`, every `instance.json`,
  `docs/DEPLOY.md`.
- Deploys: about 3½ minutes shorter for a client instance. Measured from Railway's build log, not
  yet re-measured after the change.
