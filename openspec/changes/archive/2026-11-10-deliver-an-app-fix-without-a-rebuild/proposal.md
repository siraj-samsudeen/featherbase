## Why

The owner fixes a small problem while people are on a call testing with him, and wants the fix live
in under a minute (#1178, D8). Even after #1177 a deploy rebuilds and restarts the whole server,
about two minutes. Most fixes change only one app's code.

## What Changes

- A running instance accepts an app's built files from its deploy pipeline, holding a deploy key,
  and serves them at once, without a rebuild or a restart. This is the Vercel model: ship only what
  changed.
- Only a code change to the installed version is taken. A change to what the app declares (its
  tables, roles, grants) is refused and needs an ordinary deploy, which upgrades it.
- The delivered files are kept on the instance's volume, so a restart serves them too. The next
  ordinary deploy replaces them with the image's files.
- Off unless the instance has a deploy key (`APP_DELIVERY_TOKEN`).

## Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: an app's code fix can be delivered to a running instance.

## Impact

- New `apps/server/src/app-delivery.ts`, a route `/deliver/app`, `tools/deliver-app.mjs`.
- `runtime-packages.ts` (a delivered copy wins over the image's copy of the same version),
  `index.ts` boot, `release-preflight.ts`, `deploy-instance.ts` (an ordinary deploy clears
  delivered copies), `env.ts`, `docs/DEPLOY.md`.
- Security: the route runs code on the server, so it needs a long random key, held only by the
  deploy pipeline. It needs the owner's review before it is turned on anywhere.
