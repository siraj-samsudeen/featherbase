# Feather Dash — local fixture test drive

Independent Featherbase package for issue #3381. This milestone serves a complete
Sales Target vs Actual viewer from disposable synthetic data. It does **not** resolve
arbitrary MotherDuck URLs, compile existing Dive TSX, or provide the final Publisher
workflow. The UI states those limits.

## Build and host bootstrap

```bash
cd /absolute/path/to/data-warehouse/featherbase_apps/feather_dash
npm install
npm run build

export FEATHERBASE_APP_PATHS="$(node -p 'JSON.stringify([process.cwd()])')"
export FEATHER_DASH_FIXTURE="$PWD/fixtures/source.json"
export FEATHER_DASH_PROVIDER_STATE=/absolute/private/path/feather-dash-provider.json
export NODE_OPTIONS="--import=$PWD/dist/development-bootstrap.mjs"
```

Start Featherbase in the same process environment. `development-bootstrap.mjs` imports
the same package registry through a process-global symbol before package callbacks run.
It refuses startup without both paths. The state path is server-only, mode 0600, and
persists publication history, demand and the private shared cache across process restart.
It must not be inside a served client directory.

The fixture adapter accepts only the package's known Dive identity and immutable
`fixture-r1` definition. A differently identified state file fails startup rather than
silently substituting demo data for an arbitrary MotherDuck URL. A production adapter
must implement the same `catalog/read/refresh/scheduledRefresh` interface and remain
server-configured; no browser datasource configuration is supported.

## Install and seed

Install the package through Featherbase's normal `/api/install_app` flow after discovery.
Create local users with platform roles and Data Scope using host APIs; do not copy roles
into `feather_dash.access`.

Generate the exact app-owned rows after replacing values with real Featherbase user ids:

```bash
FEATHER_DASH_TL_A_USER=... \
FEATHER_DASH_TL_B_USER=... \
FEATHER_DASH_DM_USER=... \
node seed/rows.mjs > /tmp/feather-dash-seed.json
```

Save each emitted `{table,row}` through the authenticated administrator
`POST /api/save_row` endpoint. Assign **Feather Dash Viewer** through the platform role
model and grant Data Scope for each exact store row separately. The generic platform
gate checks those fresh roles/stores before app product facts are read.

The fixture identities deliberately exercise:

- TL A: Kattakada codes `100000001` and `100000003`;
- TL B: same store, different repeated-label code `100000002`;
- DM: Kattakada `100000002` plus Attakulangara `100000004` as exact pairs.

These local rows are precomputed employee-scope facts. `graph_complete` records whether the
fixture considers the DM span complete; the fixture does not traverse an authoritative live
employee reporting graph. A production scope writer must derive sections and exact pairs from
that current graph before writing the fact. Missing or incomplete derivation must write no
usable scope and therefore deny.

Changing a role, Data Scope, or `feather_dash.access` row affects the next read. Set a
DM's `graph_complete` false to exercise unresolved authoritative reporting-span denial.

## Browser/client contract

The client first calls `GET /api/runtime_app_versions`, pins the returned full identity
snapshot, and supplies it on every read. It never hard-codes an app version. It uses:

- `POST /api/app_reads/feather_dash/catalog` with `{ "payload": {} }`;
- `GET /api/app_reads/feather_dash/sales_target/access` for current store discovery;
- `POST /api/app_reads/feather_dash/sales_target` with a named period, all discovered stores
  by default, optional store/subcategory narrowing and an exact store-plus-code drill pair.

## Known platform block

Featherbase c7a47b2 cannot safely combine all-signed-in catalog read with Publisher-only
runtime actions. Table actions gate on entry-table read; stores actions require a false
store dimension; handler-only role checks do not secure idempotent replay after revocation.
Accordingly this package declares no preview/publish/unpublish actions. The prepublished
fixture is loaded only by the trusted server bootstrap. Private definitions/cache are not
placed in viewer-readable app tables or authorization facts.
