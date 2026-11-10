## 1. Tests

- [ ] 1.1 Scenario test "An app upgrades once its old files are gone" in `apps/server/test/scenarios/trusted-runtime-packages.test.ts`
- [ ] 1.2 Unit tests: the deploy preflight accepts an unshipped installed version when a newer one ships, and still refuses one with no newer version; the instance deploy upgrades it

## 2. Server

- [ ] 2.1 The upgrade plan reads the installed version from its installed record
- [ ] 2.2 The preflight and the instance deploy accept an installed version that a shipped newer version replaces

## 3. Build

- [ ] 3.1 `previousVersions` leaves `instance.json`, `tools/build-instance-apps.mjs` and its tests
- [ ] 3.2 The Dockerfile's old Tickets stages go
- [ ] 3.3 `docs/DEPLOY.md` says an upgrade needs only the new version
