# Proposal

## Why

A dev deployment with the preview variables set went green, but its pre-deploy step ran only the release: the preview seed, chained after it with `&&` in one `railway.json` entry, never ran (#307). The `/preview` link then answered "User cannot sign in", because the person it names did not exist. A green deploy must not leave the preview link pointing at nobody.

## What Changes

- The deploy has one pre-deploy command, `pnpm --filter server pre-deploy`. It runs the release, then the preview seed, and fails if either fails. Nothing in the deploy config depends on a shell reading `&&`.
- The preview seed saves the preview person through the full Person save chain (#534).
- `seed:preview` is removed; re-running `pre-deploy` is safe, because both steps converge.
- `PREVIEW_USER_NAME`, which the seed already read, is listed with the other variables.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `running-an-instance`: a deploy with preview sign-in configured ends with the preview person in place, or fails.

## Impact

New `apps/server/src/pre-deploy.ts` and `src/preview-seed.ts` (from `scripts/seed-preview.ts`); `railway.json`; `docs/DEPLOY.md`, `docs/PREVIEW.md`; `src/env.ts`. No migration.
