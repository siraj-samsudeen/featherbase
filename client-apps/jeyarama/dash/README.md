# Feather Dash

Feather Dash is a client app built for JeyaRama on Featherbase: the store
staff's month-to-date sales-against-target report, the store org chart that
decides who sees which sections, and the scope provider that turns the org
chart into each reader's places. Its app id is `feather_dash`, so its Tables are
`feather_dash.*`.

It lives in featherbase's `client-apps/` (ADR 0014). Platform and app share
one commit, so a platform change and the app change that needs it are one PR.
The instances' settings, the privacy notice and the one-off setup steps live in
the client's private instance repository, never here. JeyaRama's conventions
shared by its apps are in `../CLAUDE.md`.

**Version 0.1.0.** It arrived here as a snapshot, without its earlier history
and with no upgrade history (`migrations` is empty): go-live is a fresh
install, and the platform is fresh-install only. Its version changes only in a
release PR (ADR 0014, section 4). A client image is built when the app is
released, not here.

## Layout

| Path | What it is |
|---|---|
| `package.json` | the app's identity (`version` is the app version) and its build scripts |
| `featherbase.json` | the manifest: Tables, the scope provider, roles, grants, datasets and declared reads; `migrations` is the upgrade history (empty at 0.1.0) |
| `src/server.ts` | the server module, bundled by esbuild to `dist/server.mjs` |
| `src/validators.ts` | the org chart Tables' save rules |
| `src/coverage.ts`, `src/provider.ts` | coverage on the new org chart, and the scope provider |
| `src/legacy-derivation.ts` | today's derivation from the old Store Sections Tables |
| `src/conflicts.ts`, `src/compare.ts`, `src/compare-cli.ts` | a store's conflict list and the coverage comparison |
| `src/report.ts` | the report's rules: a reader's stores and scope, the month-to-date rows and totals, the Dive's `initial_state` |
| `src/page.ts`, `src/app.tsx`, `src/main.tsx`, `index.html` | the report page (the Dive, the quick view, the empty states; `page.ts` holds its rules and the async guard), built by Vite to `dist/client` |
| `platform-test/` | tests that run inside this repository's server test harness (`npm run test:platform`), with `mark-scope-tables.mjs`, the instance setup step they rely on |
| `scripts/platform-test.sh` | the platform test runner |
| `scripts/platform-loads-app.mts` | runs the platform's own app loader over this folder |
| `scripts/seed-made-up.mts` | local development only: made-up stores, people and a cached copy, to see every state of the page |
| `scripts/dev-repin.sh` | local development only: re-pins a dev database's install after a server edit |
| `fixtures/made-up-org-chart.json` | made-up data for the comparison: no real store, person, code or figure |

## Build and test

`pnpm apps:prepare` at the repository root installs, builds and tests this app
along with the others. By hand, from this folder, after `pnpm install` at the
root:

```sh
npm ci
npm run build                      # typecheck, dist/client, dist/server.mjs
npm test
npm run typecheck
```

Some tests borrow from the repository around this folder: one runs the
platform's own loader (what boot discovery and the release guard use) over the
built folder, one renders the page with `apps/web`'s jsdom, and one runs the
dataset query on `apps/server`'s DuckDB. So run `pnpm install` at the root and
build first.

The platform tests run inside `apps/server`'s own test harness, against a test
database of your own (the harness migrates it and empties its job queue):

```sh
createdb -h 127.0.0.1 -U postgres feather_dash_platform_test
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/feather_dash_platform_test
(cd ../../../apps/server && NODE_ENV=test pnpm migrate)
npm run test:platform              # or: npm run test:platform -- provider.test.ts
```

They prove the save rules on the platform's save path, the provider through
the platform's own `resolvePersonScope`, the report reads under real places,
and the refresh guard on `sales_to_date` (against a made-up warehouse in an
in-memory DuckDB, `platform-test/warehouse.ts`). CI runs them when a PR
touches `client-apps/` or the platform.

## Local development

The repository's own dev server runs this folder as one of its apps, on its own
ports and database, while `npm run dev` here rebuilds the client and the server
module on every save. There is no image and no second checkout.

1. **Boot featherbase with this app**, from the repository root, on a database
   and ports of your own (`./init.sh` stops whatever listens on its ports):

   ```sh
   createdb -h 127.0.0.1 -U postgres feather_dash_dev
   FEATHERBASE_CLIENT_APPS="jeyarama/dash" \
   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/feather_dash_dev \
   API_PORT=8100 WEB_PORT=5180 ./init.sh
   ```

   `FEATHERBASE_CLIENT_APPS` adds `client-apps/jeyarama/dash` to the example
   apps on the app path. `pnpm apps:prepare`, which `init.sh` runs, builds it.
   The API log is `/tmp/featherbase-server-8100.log`.

2. **Install the app, once per database**, as `Administrator` (development
   password `admin`):

   ```sh
   TOKEN=$(curl -s -H 'content-type: application/json' \
     -d '{"usr":"Administrator","pwd":"admin"}' localhost:8100/api/login |
     node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).token))')
   curl -s -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
     -d '{"name":"feather_dash"}' localhost:8100/api/install_app
   ```

   Then open `http://localhost:5180/feather_dash/`.

3. **Start the watchers** here, and leave them running: `npm run dev`.

| You edit | What happens | What you do |
|---|---|---|
| the client (`src/*.tsx`, `src/style.css`, `index.html`) | Vite rebuilds `dist/client`; the platform reads the client from disk on every request. | Refresh the browser. |
| the server module (`src/server.ts`) | esbuild rebuilds `dist/server.mjs` and the dev server restarts. The platform fingerprints the app folder, so the installed app no longer matches it: the server log warns `App feather_dash version … is installed and enabled, but this server does not have it`. | `DATABASE_URL=… npm run dev:repin` re-pins the dev database's install to the folder and restarts the server. |
| `featherbase.json` | A manifest change is a schema change. | Recreate the dev database and install again. `dev:repin` refuses a changed manifest. |

The same warning follows any restart once the client was rebuilt since the
last pin; `dev:repin` fixes that too. It refuses a database not stamped
`development`.

### Seeing the report locally

There is no MotherDuck locally, so the Dive can't open; the page shows the
quick view, built from a made-up cached copy. Start the dev server with
`MOTHERDUCK_TOKEN=made-up-local-token` in its environment (every read needs
the secret set), install the app, then from `apps/server`:

```sh
FEATHER_DASH_API=http://localhost:8100 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/feather_dash_dev \
  node_modules/.bin/tsx ../../client-apps/jeyarama/dash/scripts/seed-made-up.mts ../.. ../../client-apps/jeyarama/dash
```

It signs in made-up readers (`reader-many@example.test`, `reader-one@…`,
`reader-none@…` and more; the script lists them) with the local password
written in the script.

## What the manifest declares

- **`feather_dash.store_rollout`**, the entry Table and the per-store live
  switch: a store with a row live on or before today uses the new org chart.
  It is marked `decides_scope`, so only a System Manager writes it; the three
  app roles read it, because the platform opens an app only for people who can
  read its entry Table.
- **The read grants for stage D** (section editing): the Section Editor and
  the Section Reviewer read every org chart Table. The Reader reads nothing
  but the entry Table: the report reads the cached dataset through the
  reader's places, never a Table. Writes wait for featherbase #462.
- **The store org chart Tables** (featherbase#630), added by the upgrade's one
  `store_org_chart` step: `store_floor`, `department`, `section`,
  `section_subcategory`, `display_location`, `job_assignment`,
  `section_alias`, `floor_alias` and `job_alias`. All flat. The first five that
  decide coverage are marked `decides_scope`.
  - Names are unique within a store through read-only key columns the save
    rules write (`floor_key`, `department_store_key`, `name_store_key`,
    `section_key`, `placement_key`, `alias_key`), because the platform's
    `unique` is one column wide.
  - The save rules also refuse a store code that is not four digits, a
    subcategory that is not nine, an end on or before the start, a changed
    `department_key`, and a job assignment of the wrong shape (a Floor Manager
    names one floor, a Department Manager one department, a Team Leader or
    Staff member one section, a Store or Cluster Manager none).
- **The scope provider, `org_chart`.** Per store: the new chart for a live
  store (places `confirmed`), today's derivation for any other (`assumed`).
  One place per covered section, labelled `<store> / Section: <name>`, plus
  the store itself (`<store>`) for a Store or Cluster Manager, and for old-rule
  subcategories outside the merchandise map. Filters: `store` (plant code) and
  `subcategory` (the subcategory code, `material_group_code`) only, because the
  platform drops any place a dataset can't apply. The report reads each
  subcategory's section from its place's label. Each place's `basis` names the
  jobs that give it (`team_leader`, `acting_section_staff`, …; an old-rule place
  carries its own subcategories' bases, #4486), which the page's header turns
  into its "why" sentence. The old rules read the six old Tables, which must be
  marked `decides_scope` by instance setup at the cut-over (a step kept in the
  client's private instance repository; `platform-test/mark-scope-tables.mjs`
  is the tests' copy of it); a read of an unmarked one fails the whole scope.
  - **Employee codes come from the platform** (featherbase #660): the manifest
    declares the `stylehr-employee-code` identifier system, and the provider
    gets the person's codes valid today. An instance without that system (or
    with it turned off) answers "not set up yet" before the provider runs.
  - **Shared codes, as today's rules have them.** Each code the platform hands
    over says whether another person holds it today (`shared`). A person with
    any shared code gets nothing from the old rules, explicit assignment rows
    included; a person whose codes are all unshared gets what those codes
    derive plus their explicit rows; a person with no code gets their explicit
    rows (`fromIdentifiers` in `src/provider.ts`). Live stores are unaffected.
- **Roles:** Feather Dash Reader, Feather Dash Section Editor, Feather Dash
  Section Reviewer. `roleDefaults` is empty; part 4 adds the stand-in binding.
- **The cached dataset, `sales_to_date`**, on the instance's `motherduck` Data
  Source (which must be marked "Read-scaling token"): one row per store and
  subcategory, month to date in India Standard Time, with target, sales, the
  day the data runs to and whether the month has targets. It is today's
  featherbase query (`datasets/sales-target-mtd.ts`) moved here, cut to month
  to date. The platform refreshes it, keeps the last good copy, and limits it
  to each reader's places through `filters` (`store` → `store_code`,
  `subcategory` → `subcategory_code`). Its `guard` keeps the last good copy
  too when a refresh has no target at all (`not_all_zero` on `target`), or,
  within the same `period_start`, when the subcategories with a target
  (`max_drop_pct: 50`), the month's total target (`max_sum_drop_pct: 50`) or
  the days with a target (`target_days`, summed: `max_sum_drop_pct: 50`) drop
  by more than half: the old report's checks, which counted target day rows.
  `target_days` is for that guard only; nothing shows it, and the Dive's
  `cached` rows leave it out. A refresh of a new month
  is not compared with last month's copy, and one whose rows carry no single
  `period_start` is refused.
- **The month's metadata, `sales_month`**: one row per store and subcategory
  with only `period_start`, `data_through` and `targets_available`, limited
  to the reader the same way. It tells a month that hasn't arrived from a
  section that sold nothing, whose figures are empty either way.
- **The reads** (`POST /api/app_reads/feather_dash/<read>` with
  `{"payload":{…}}` and the header `X-Featherbase-App-Version:
  feather_dash@<version>`, which the client sends):
  - `me` → `{ user }`;
  - `stores` → the reader's stores for the bar's picker, whose labels the
    platform's bar draws (the single-store label too):
    `[{ value: "9901", label: "Lakeside" }]`. A label is the store's name
    alone, never its plant code (#4531); two stores of one name are told
    apart by their short codes ("Lakeside · LKS"), else numbered
    ("Lakeside (1)"); a store with no name known goes by its short code,
    else "Your store" or "Store 1";
  - `report` `{ store }` → one store's cached report (what the quick view
    shows), with a `state` of `ready`, `not_built`, `no_data_yet` or
    `no_sections`, and a `heading` for the page's header: the store's short
    name (never its plant code), its sections, and the reader's reasons there
    (`[{ basis, sections }]`, each basis on the store's places with the
    sections those places name). The page turns the reasons into one sentence
    (`whyLine` in `src/page.ts`), and leaves it out when none is known;
  - `embed_session` `{ store }` (outbound) → `{ frame }` (the Dive's address),
    `{ not_set_up: true }` or `{ unreachable: true }`. The Dive's
    `initial_state` carries `plant_code`, `whole_store` (a Store or Cluster
    Manager: the Dive should filter on the store alone), `material_groups`,
    `section_by_material_group`, `period_start`, `period_end` and, when the
    whole state fits in 56 KB, `cached: { refreshed_at, data_through, rows }`
    with rows shaped as the Dive's live query answers them
    (`hierarchy_code`, `subcategory`, `mtd_target`, `mtd_actual`,
    `days_with_actual`, `days`).
  The last three are `person_scope` reads for the three app roles.
- **The Dive's settings** (optional: without them the page shows the quick
  view): `dive_id`, `dive_version`, `embed_service_account`, and
  `dive_ready_signal` (`on` once the Dive posts `{ type:
  "feather-dash:dive-ready" }` to the page when it has drawn, B7; until then
  the frame's `load` counts as ready); the secret
  `MOTHERDUCK_TOKEN` (every read answers "not set up" while it is missing);
  `frameOrigins: ["https://embed-motherduck.com"]`.

## The coverage comparison

Before a store goes live, compare every person's coverage under the old rules
and the new chart:

```sh
npm run compare -- --input fixtures/made-up-org-chart.json --date 2026-10-15
FEATHERBASE_TOKEN=<System Manager token> npm run compare -- --url https://<instance> --store <plant code>
```

Per store it lists each person's old and new subcategories, every difference
with its reason, the store's conflicts, and what needs matching (employee codes
in the old Tables that match no one; old section names that match no section or
section alias). `--json` answers JSON. A store goes live only when both lists
are empty and the comparison is accepted. Needs Node 22.18 or later.

**Known interim on an app address.** Until featherbase's cut-over retires
today's Sales Target page (design D8, B9), the platform routes an address that
opens `feather_dash` to that page (`INTERIM_APPS` in featherbase's
`packages/shared/src/app-routes.ts`). The app itself is served at
`/feather_dash/` on the Admin address, and on a dev machine with
`INSTANCE_ADDRESSES` unset.
