# Feather Dash

Feather Dash is a client app built for JeyaRama on Featherbase: the store
staff's month-to-date sales-against-target report, the store org chart that
decides who sees which sections, and the scope provider that turns the org
chart into each reader's places. Its app id is `feather_dash`, so its Tables are
`feather_dash.*`.

It lives in featherbase's `client-apps/` (ADR 0014). Platform and app share
one commit, so a platform change and the app change that needs it are one PR.
The instance's settings, the privacy notice and the one-off setup steps are in
`../instances/dash/`. JeyaRama's conventions
shared by its apps are in `../CLAUDE.md`.

**Version 0.10.1.** It arrived here at 0.10.0, the version data-warehouse last
shipped, as a snapshot without its earlier git history and with no upgrade
history: go-live is a fresh install, and the platform is fresh-install only.
0.10.1 lists the published Sales Target Dive v13 as compact-aware, with one
code-only upgrade step (`compact_sales_target_dive_v13`, 0.10.0 → 0.10.1). Its version changes only in a
release PR (ADR 0014, section 4). A client image is built when the app is
released, not here.

**What the page does today.** The header names the store, the period, why the
reader sees that store, and "Sales before tax, net of returns" (the `report`
read answers a `heading` for it). Readers never see internal codes: the quick
view names subcategories without their codes, and the store picker names
stores without plant codes. `sales_to_date` carries the month's target and
actual quantities for the Dive's cache, and the page tells the Dive its own
origin for the ready message. The compact whole-store state follows the pinned
Dive (`COMPACT_DIVES` in `src/server.ts`), which lists the Sales Target Dive at
v13 only; every other pin gets the plain scope keys (see "Turning on the
compact state"). The history behind these is in the client's
repository (data-warehouse #4486, #4531, #4453).

## Layout

| Path | What it is |
|---|---|
| `package.json` | the app's identity (`version` is the app version) and its build scripts |
| `featherbase.json` | the manifest: Tables, the scope provider, roles, grants, datasets and declared reads; `migrations` is the upgrade history (it starts at 0.10.0, where the app was installed fresh) |
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

`pnpm apps:prepare` at the repository root installs and builds this app along
with the others; CI runs its tests. By hand, from this folder, after `pnpm
install` at the root:

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

1. **Boot the instance**, from the repository root. This creates the database,
   builds and installs the app, applies the settings and starts the servers:

   ```sh
   pnpm dev:jeyarama
   ```

   It prints where to go and how to sign in. Set `API_PORT`, `WEB_PORT` or
   `DATABASE_URL` for ports and a database of your own (`.env.example`).

2. **Open** `http://localhost:5173/feather_dash/` and sign in as
   `Administrator` (development password `admin`).

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
FEATHER_DASH_API=http://localhost:8000 DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/fb_jeyarama_dash \
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
  marked `decides_scope` by instance setup at the cut-over (`../instances/dash/instance-setup/mark-scope-tables.mjs`, which runs
  `platform-test/mark-scope-tables.mjs`, the function the tests use too); a read of an unmarked one fails the whole scope.
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
  `cached` rows leave it out. `target_quantity` and `actual_quantity`
  are for the Dive's cache only: the quick view shows values alone. They come
  from the same rows as the values (the mart's day row, else the day's sales
  lines' `qty_net`). A refresh of a new month
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
  - `embed_session` `{ store, app_origin }` (outbound) → `{ frame }` (the Dive's address),
    `{ not_set_up: true }` or `{ unreachable: true }`. It reads only the cached
    copies, and nothing live except, in the legacy state with nothing
    cached, a whole-store reader's subcategories. The Dive's
    `initial_state` carries `plant_code`, `whole_store`, `period_start`,
    `period_end`, `app_origin` (the page's own origin, which the page sends,
    when it is a plain `http(s)` origin: the target of the Dive's ready
    message), the reader's scope and `cached`.
    - **Scope.** `whole_store` is worked out from the reader's places, never
      from the request. A section reader gets `material_groups` and
      `section_by_material_group`, and the Dive limits every query to them. A
      whole-store reader's keys follow the pinned Dive (`dive_id` and
      `dive_version`):
      - **compact**, only for a Dive and version listed in `COMPACT_DIVES`
        (`src/server.ts`; the Sales Target Dive at v13): no
        `material_groups` or `section_by_material_group`; the Dive filters
        on the store alone, and the sections come as `sections: { <name>:
        [codes] }`;
      - **legacy**, for any other pin (an older version, another Dive, a
        version that is not plain digits): the plain scope keys, the full
        `material_groups` (the places', the cache's and, with nothing cached,
        the warehouse's subcategories) and `section_by_material_group`. A
        Dive before v13 does not read the compact state (one before v12
        reads a missing `material_groups` as "every store"), so no setting
        can give it the compact state. A later version that
        keeps the format is added to `COMPACT_DIVES` in a new app version.
    - **`cached`, version 1:** `{ v: 1, refreshed_at, data_through, q, cols }`
      or the same with `z` in place of `cols` (the columns as JSON, gzipped,
      base64). `cols` is `{ c, n, t, a, tq?, aq? }`, one array per field: codes
      (numbers, ascending, the first and then each step; `sections` writes
      codes the same way), names, target and actual in whole paise, and
      target and actual quantity in whole thousandths (only with `q: true`).
      Only subcategories with a day this month are listed.
    - **The 56 KB budget** is for the whole state, one store: plain with
      quantities, else compressed with quantities, else compressed
      value-only, else no `cached` at all. Rows are never cut. Measured with
      made-up data (random-letter names, which compress worse than real
      ones), in the compact state a whole-store reader keeps quantities up to
      about 1,600 subcategories and gets a value-only cache up to about
      2,200; in the legacy state the full list leaves room for a cache only
      up to about 600 subcategories. A section reader always gets the plain
      cache.
    - **Too large to embed.** MotherDuck refuses an `initial_state` past
      64 KB. A state past `EMBED_STATE_LIMIT_BYTES` (63,000: under 64 KB
      whether a kilobyte is 1,000 or 1,024 bytes) is never sent and never
      trimmed: `embed_session` answers `{ too_large: true }`, the page shows
      the quick view with "This store is too large for the interactive
      report yet. Showing the cached table.", and the server logs
      `feather_dash_embed_state_too_large` naming the store (no person). In
      the legacy state that starts at about 1,525 subcategories (made-up
      data, 40 sections). The platform pinned here has no app-facing
      Instance health check, so the log line is the operator's signal.
  The last three are `person_scope` reads for the three app roles.
- **The Dive's settings** (optional: without them the page shows the quick
  view): `dive_id`, `dive_version`, `embed_service_account`, and
  `dive_ready_signal` (`on` once the Dive posts `{ type:
  "feather-dash:dive-ready" }` to the page when it has drawn, B7; until then
  the frame's `load` counts as ready); the secret
  `MOTHERDUCK_TOKEN` (every read answers "not set up" while it is missing);
  `frameOrigins: ["https://embed-motherduck.com"]`.

## Turning on the compact state

The app lists a Dive version in `COMPACT_DIVES` only once that version is
published: listing one early could name an older Dive, which reads a missing
`material_groups` as every store. On any other pin, a whole-store reader of a
store over about 600 subcategories gets no cache, and one over about 1,525 gets
the cached table instead of the Dive.

1. Done: the cached-first Sales Target Dive is published as v13 (v12 is an
   older wording-only version, not compact-aware).
2. Done: 0.10.1 adds `'9022f10f-be83-4fba-a729-5399c18d150e': [13]` to
   `COMPACT_DIVES` (featherbase#712).
3. Pin `dive_version=13` on dev only, with 0.10.1 deployed.
4. Check the real embed on dev (cached, then live, and whether the ready
   message arrives); only then set `dive_ready_signal=on`.

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
