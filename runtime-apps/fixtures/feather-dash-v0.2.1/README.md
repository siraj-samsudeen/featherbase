# Feather Dash — live MotherDuck Dev preview

Independent Featherbase package for issue #3902. Version 0.2.1 preserves the deployed
Sales Target vs Actual viewer and replaces its disposable fixture provider with a
server-owned MotherDuck source for exact Dive
`9022f10f-be83-4fba-a729-5399c18d150e` version 9.

This is one reviewed bounded conversion, not automatic execution or compilation of arbitrary Dive
TSX. The source boundary is Kattakada (`1515`) for the warehouse anchor's current month. Publisher,
employee-reporting-graph derivation, other stores/reports, host scheduling, and production are out
of scope.

## Build and host bootstrap

```bash
cd /absolute/path/to/data-warehouse/featherbase_apps/feather_dash
npm ci
npm run build

export FEATHERBASE_APP_PATHS="$(node -p 'JSON.stringify([process.cwd()])')"
export FEATHER_DASH_MOTHERDUCK_STATE=/absolute/private/path/feather-dash-motherduck-provider.json
export FEATHER_DASH_MOTHERDUCK_PRINCIPAL=dbt_dev_service_account
export MOTHERDUCK_TOKEN='server-only service-account token'
export NODE_OPTIONS="--import=$PWD/dist/development-bootstrap.mjs"
```

Start Featherbase in that same process environment. `development-bootstrap.mjs` registers the
provider before package callbacks run and fails closed when any required configuration is absent.
The token is passed to DuckDB as configuration, never in a URL. The provider checks
`current_user()` against `FEATHER_DASH_MOTHERDUCK_PRINCIPAL` and verifies the attached `marts` and
`gold` aliases resolve to the exact Dive-declared share URLs before source queries.

`FEATHER_DASH_MOTHERDUCK_STATE` is private server storage, outside any client-served directory. The
provider writes mode-0600 atomic JSON containing the compatible last-good source snapshot and cache
metadata, but no credential. A cold read verifies the exact Dive-v9 digest/resources, builds and
validates one snapshot, persists it, and returns a live result. Compatible later reads use the
private cache and reapply current exact pairs. A source or persistence failure never activates a
partial candidate. Featherbase runtime packages have no job ABI at the pinned host contract, so
this package provides demand refresh only and does not claim scheduled refresh.

## Install and seed

Build the package, run `npm pack`, and install the exact tarball through Featherbase's normal app
discovery/preview/upgrade/activation lifecycle. `FEATHERBASE_APP_PATHS` must be a JSON array of
absolute package paths.

For the `0.1.3` → `0.2.1` transition, keep both immutable package paths discoverable and import both
bootstraps before previewing the upgrade. The old fixture bootstrap continues using
`FEATHER_DASH_PROVIDER_STATE` and `FEATHER_DASH_FIXTURE`; this package uses the distinct
`FEATHER_DASH_MOTHERDUCK_STATE`. Provider registration is module-local, so each package's handlers
can resolve only its own provider. After activation and restart proof, remove the old bootstrap and
package path from the Dev service.

The Dev seed output contains public report/store metadata plus one precomputed private-preview fact:

```bash
FEATHER_DASH_PREVIEW_USER='exact Featherbase user row id' \
node seed/rows.mjs > /tmp/feather-dash-seed.json
```

Save each emitted `{table,row}` through the authenticated administrator `POST /api/save_row`
endpoint. Assign **Feather Dash Viewer** and Kattakada Data Scope through Featherbase's platform
role/store model. Do not copy either gate into app facts. The app fact contains only the current
private preview's precomputed sections and exact pairs:

```json
{"employee_id":"DEV-PREVIEW","employee_kind":"TL","graph_complete":true,"sections":["Precomputed Dev preview"],"pairs":[["1515","010502001"],["1515","010502003"]]}
```

This row does **not** prove StyleHR identity or reporting-graph traversal. It is the explicit private
Dev preview boundary. Missing, malformed, stale, or incomplete facts deny on the next read.

## Browser and source contract

The client fetches `GET /api/runtime_app_versions`, pins the returned full active identity, and sends
it on every app read. It never hard-codes a package version or sends SQL, credentials, relation
names, or a Dive URL. Browser operations remain the existing named `catalog` and `sales_target`
reads. The server's one published definition owns the immutable source identity, SQL conversion,
cache revision, and report evaluator.

The exact source revision is:

- Dive ID/version: `9022f10f-be83-4fba-a729-5399c18d150e` / 9
- content SHA-256: `fa457921ce45ccea3b3fbf3f743904c5d8dce233c0f76607d23920bbc9b35b6b`
- source store: `1515` (Kattakada)
- resources: exact Dive-v9 `marts` and `gold` shares

Changing the current Dive does not change this package. Adopting another version requires a new
immutable app revision, review, and proof.
