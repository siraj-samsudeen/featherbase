## Why

A release refused to upgrade an installed app unless the image also shipped the installed version (#924). On 02-Nov staging deploys were refused this way for Tasker 2.3.2, and every upgrade meant rebuilding old versions from archives beside the new ones. The upgrade only needs the installed version's declaration, and the database already records it at install and upgrade.

## What Changes

- An upgrade starts from the manifest, version and fingerprint the instance recorded, not from the installed version's files. The old files are used only when the record can't be read.
- An instance deploy's preflight passes an installed app whose newer version ships, and says it will upgrade it. It still refuses, before any migration: an app the image ships no version of (with the disable hint), an image whose newest version is not newer (a rollback), a new version with no migration from the installed one, and a step that needs the installed version's own files, which it names.
- The Jeyarama dash instance stops rebuilding previous versions.

## Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: an upgrade needs only the new version.

## Impact

- `runtime-packages.ts` (upgrade plan, `unshippedFate`), `release-preflight.ts`, `deploy-instance.ts`. No migration, no schema change.
- This repository's default image keeps its previous Tickets builds: it has no deploy step, so an administrator upgrades from Apps after the server starts.
