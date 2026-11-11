# Remove MySQL as a supported data source

## Why

The owner decided on 11-Nov-2026 that MySQL is no longer a supported data source (#1199). No instance uses it: production and staging each have one data source, on MotherDuck. Keeping it costs a driver dependency, a MySQL service in every CI run, and tests and docs for an engine nobody connects.

## What Changes

- Featherbase stops offering MySQL: the Connect Source page, the engine's choices and the restriction guidance no longer name it.
- **BREAKING** for any MySQL data source saved before this change: it is refused wherever it is used, naming MySQL as no longer supported and saying to delete the source. None is known to exist.
- The MySQL driver, its tests, the CI MySQL service and the docs go; a new ADR records the decision.

## Capabilities

### Modified Capabilities

- `external-data-sources`: MySQL leaves the supported engines and the restriction guidance; a source on an unsupported engine is refused with a clear message.

## Impact

- `apps/server/src/sources/` (registry, types, reflect, the MySQL driver), `apps/server/package.json` (`mysql2`), a new migration for the engine's choices.
- `apps/web/src/pages/ConnectSource.tsx`.
- `.github/workflows/test.yml` (the `mysql:8.4` service, `MYSQL_TEST_URL`), `apps/server/vitest.config.ts`.
- `docs/TESTING.md`, the `connect-an-outside-database` skill, a new ADR superseding the MySQL provisions of ADRs 0007, 0012, 0016, 0017 and 0023.
