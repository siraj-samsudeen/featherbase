# Dash

Dash is a client app built for JeyaRama on Featherbase: it opens any MotherDuck Dive for a store's
staff, sending the Dive only the filters that reader's job allows. Who reaches what comes from the
core Tables (Employee, Job Assignment, Site, Plant, Section, Section Subcategory). Its app id is
`dash`, and `dash.report`, one row per Dive, is the only Table it owns.

It lives in featherbase's `client-apps/` (ADR 0014). Platform and app share
one commit, so a platform change and the app change that needs it are one PR.
The instance's settings, the privacy notice and the one-off setup steps are in
`../instances/dash/`. JeyaRama's conventions
shared by its apps are in `../CLAUDE.md`.

**Version 0.12.0.** It arrived here at 0.10.0, the version data-warehouse last
shipped, as a snapshot without its earlier git history and with no upgrade
history: go-live is a fresh install, and the platform is fresh-install only.
0.10.1 lists the published Sales Target Dive v13 as compact-aware, with one
code-only upgrade step (`compact_sales_target_dive_v13`, 0.10.0 → 0.10.1). Its version changes only in a
release PR (ADR 0014, section 4). A client image is built when the app is
released, not here.

**What the page does today.** The sidebar lists the reader's reports. The header names the store,
the period and why the reader sees that store. Readers never see internal codes: the store picker
names stores without plant codes. The page opens each Dive's latest saved version: no version is
pinned anywhere, so saving a Dive on MotherDuck releases it (#937). The Dive is the report: Dash
copies no figures into Featherbase (#1366), so a Dive that can't load says "This report couldn't
open" with Try Again; a request that got no answer at all (it failed on the way or ran out of
time) says "Couldn't reach Dash. Check your connection, then Try Again." instead (#1391). A Dive not
up within 15 s (`DIVE_READY_TIMEOUT_MS`) keeps loading out of sight behind that message; if it then says it is ready, the page switches to it in the same frame. A frame
that errors stays failed (#1143). Every report a reader opens is one `view_report` row in the Access
Log, written when its Dive's session is opened (#1366).

## Layout

| Path | What it is |
|---|---|
| `package.json` | the app's identity (`version` is the app version) and its build scripts |
| `featherbase.json` | the manifest: Tables, the scope provider, roles, grants, datasets and declared reads; `migrations` is the upgrade history (it starts at 0.10.0, where the app was installed fresh) |
| `src/server.ts` | the server module, bundled by esbuild to `dist/server.mjs` |
| `src/provider.ts` | the scope provider: `reachOf`, the one place #967's who-sees-what table is written |
| `src/dive-filters.ts` | a report's row and a reader's places turned into the Dive's filters, or a refusal |
| `src/my-sections.ts`, `src/sections-page.tsx` | Your sections and Waiting for your approval (#975): the rules and the two pages. They read the instance's base Tables, declared under `baseTables` in the manifest and listed in the `linked_tables` setting, and propose through the platform's Change Proposal. The seam for posting to StyleHR is marked in `decide` and not built |
| `src/report.ts` | the report's shared rules: the heading's reasons, the month choices and their periods, the store picker's labels |
| `src/page.ts`, `src/app.tsx`, `src/main.tsx`, `index.html` | the report page (the Dive and the page's messages; `page.ts` holds its rules and the async guard), built by Vite to `dist/client` |
| `platform-test/` | tests that run inside this repository's server test harness (`npm run test:platform`), the instance setup step they rely on |
| `scripts/platform-test.sh` | the platform test runner |
| `scripts/platform-loads-app.mts` | runs the platform's own app loader over this folder |
| `scripts/seed-made-up.mts` | local development only: made-up core Tables, people and three reports, to see the page's states |
| `scripts/dev-repin.sh` | local development only: re-pins a dev database's install after a server edit |
| `fixtures/made-up-org-chart.json` | the seed's core-Table rows and people: no real store, person, code or figure |

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
built folder, and one renders the page with `apps/web`'s jsdom. So run
`pnpm install` at the root and build first.

The platform tests run inside `apps/server`'s own test harness, against a test
database of your own (the harness migrates it and empties its job queue):

```sh
createdb -h 127.0.0.1 -U postgres dash_platform_test
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/dash_platform_test
(cd ../../../apps/server && NODE_ENV=test pnpm migrate)
npm run test:platform              # or: npm run test:platform -- provider.test.ts
```

They prove the provider through the platform's own `resolvePersonScope`, one
reader per job, and that role grants decide who edits the core Tables; the report reads and the
Dive's filters under real places and the Access Log row each opening writes; and Your sections' rules. CI runs them when a PR
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

2. **Open** `http://localhost:5173/dash/` and sign in as
   `Administrator` (development password `admin`).

3. **Start the watchers** here, and leave them running: `npm run dev`.

| You edit | What happens | What you do |
|---|---|---|
| the client (`src/*.tsx`, `src/style.css`, `index.html`) | Vite rebuilds `dist/client`; the platform reads the client from disk on every request. | Refresh the browser. |
| the server module (`src/server.ts`) | esbuild rebuilds `dist/server.mjs` and the dev server restarts. The platform fingerprints the app folder, so the installed app no longer matches it: the server log warns `App dash version … is installed and enabled, but this server does not have it`. | `DATABASE_URL=… npm run dev:repin` re-pins the dev database's install to the folder and restarts the server. |
| `featherbase.json` | A manifest change is a schema change. | Recreate the dev database and install again. `dev:repin` refuses a changed manifest. |

The same warning follows any restart once the client was rebuilt since the
last pin; `dev:repin` fixes that too. It refuses a database not stamped
`development`.

### Seeing the report locally

From the repository root:

```sh
pnpm dev jeyarama/dash --made-up-data
```

There is no MotherDuck locally, so the Dive can't open and the page says the report couldn't
open; the header, the sidebar and the other pages work. The command gives the app a made-up
`MOTHERDUCK_TOKEN` (every read needs the secret set, and a real one in `.env.local`
is ignored for this run) and runs `scripts/seed-made-up.mts`, which `../instances/dash/instance.json` names. It is
safe to rerun, and it refuses a database that isn't stamped `development`.

It prints who to sign in as: each made-up person shows one state of the page. They all use the password it prints.

Without the flag the instance has no secret and no core Tables, so readers
get "couldn't load" and an administrator is told what is missing. To use another
database or other ports, set `DATABASE_URL`, `API_PORT` and `WEB_PORT` in `.env.local`
at the repository root.

## What the manifest declares

- **`dash.report`**, the entry Table and the only one Dash owns: one row per Dive, from instance
  setup. It holds the Dive's id, the shape of its filters (`One store and subcategories`, `Whole
  stores`, `Stores and subcategories` or `No filter`), the Dive's own state keys, whether the Dive
  says when it has drawn (`ready_signal`), and `quick_view`, retired and left empty (#1366). No business data. Every
  app role reads it, because the platform opens an app only for people who can read its entry Table.
  - **`pickers_in_dive`** (#1159, off by default): the Dive has its own Store and Month pickers
    (v16 of the sales Dive, data-warehouse#4739). With it on, the embed session's `initial_state` is
    exactly `reach` (`{ "<plant>": null | ["<subcategory>", ...] }` for every place the reader has,
    `null` for the whole store), `store` (only when the address names one of the reader's), `month`
    (`this` or `last`, from the address, default `this`) and `app_origin`. It carries none of the
    one-store keys, because the Dive takes `reach` beside one of them as a scope error. The bar offers
    no Store or Month for that report, and the page opens at once on the address's store. It draws
    no heading over the Dive. With no store named, the Dive opens on the reader's first store A–Z.
    Turn it on only once the row's Dive reads these keys.
- **`baseTables.read`**: the core Tables Dash reads by the columns named there. An instance lists all
  eight in the `dash.linked_tables` setting. `baseTables.propose` is what Your sections may propose.
- **The scope provider, `org_chart`.** It reads the six Tables in `scopeProvider.tables`, each of
  which it reads unmarked (`unmarkedTables`), so role grants decide who edits them. Person → current Employee → job rows in force →
  places, by #967's table:

  | Job | Reaches |
  |---|---|
  | Staff, Team Leader | their section's subcategories |
  | Floor Manager | their floor's sections |
  | Department Manager | nothing until departments are filled |
  | Store Manager | the whole store |
  | Cluster Manager | every store in their site's cluster |
  | Director, Managing Director, Chief Operating Officer | every open store of their job site's region (#1458) |
  | Head office staff | nothing |

  A store is sold through its one Store plant, so a place is a plant code. A whole-store place names
  no section. `reach_problem` says why a job reaches nothing, for the page's message.
- **Roles:** Dash Reader, Dash All-Stores Reader (reaches every store of the region of their job sites, as a Director's job does; for head-office staff, #1192, #1458) and Report Access Manager. `roleDefaults` is empty; part 4 adds the stand-in binding.
- **Datasets:** only `organisation_dives`, on the instance's `motherduck` Data Source: the
  organisation's Dives, read live for Add a Dive (#1169). Dash copies no sales figures into
  Featherbase (#1366): the Dive reads the warehouse itself.
- **The month picker** in the bar (`months` → `?month=this|last`, labelled
  "This month · Nov'26" and "Last month · Oct'26"). The value is the choice,
  not the month, so an address keeps meaning "last month". `report` and
  `embed_session` take `{ month }` (`this` when missing); `report` answers that
  month's period, and the Dive gets the month's last day under its `month_key`. The Dive caps its anchor day at `period_end` (Sales Target Dive
  v14, data-warehouse#4630), so it shows last month as it shows this month.
- **The reads** (`POST /api/app_reads/dash/<read>` with
  `{"payload":{…}}` and the header `X-Featherbase-App-Version:
  dash@<version>`, which the client sends):
  - `me` → `{ user }`;
  - `reports` → `[{ key, name, takes_store, takes_month }]` for the sidebar; none for someone whose
    job reaches nothing. Until report bundles (#1046), anyone with reach may open every report;
  - `reach_problem` → `{ problems }`, why a job reaches nothing;
  - `stores` `{ report }` → the bar's store picker: the reader's stores on a report taking one store,
    each by its name from Site, never its plant code (#4531), else `[]`, A–Z by name (#1153). Where
    more than one plant shares a site, each goes by its Plant name (`plant_name`) instead; every plant
    on the site counts except a retired one. The page's heading names a store the same way. Two
    stores of one name are numbered ("Lakeside (1)"); a store with no name known goes by "Your store"
    or "Store 1";
  - `months` `{ report }` → this month and last, `[]` on a report taking no month;
  - `report` `{ report, store, month }` → whether the report can open. `{ state: "no_access" }` for a
    report that doesn't exist or a store that isn't the reader's, `whole_stores_only`, or
    `report_not_set_up`; else `{ state: "ready", heading, period_start?, period_end? }`. `heading` is the store's name, its sections and the reader's reasons, which the
    page turns into one sentence (`whyLine` in `src/page.ts`);
  - `embed_session` `{ report, store, month, app_origin }` (outbound; its `prepare` step reads the
    report's row in the transaction) → `{ frame, ready_signal? }`, `{ refused }`, `{ not_set_up: true }`
    or `{ unreachable: true }`. The Dive's `initial_state` holds only filters, keyed by the row
    (`src/dive-filters.ts`): one store and a section reader's subcategories or the whole-store flag; a
    list of whole stores; or each store's reach (`null` for the whole store). A filter never widens: a
    reach the shape can't express is refused and MotherDuck isn't called. `app_origin` (the page's
    own plain `http(s)` origin) goes only to a Dive that says when it has drawn. Once MotherDuck
    answers a session, it writes the reader's `view_report` Access Log row (as `embed_open` does
    for a report taking no filter); a refused or failed open writes none.
    A failed open logs `dash_embed_session_failed` with the person, the report key, the Dive id, the
    status and MotherDuck's answer (`body`), cut to 500 characters with every secret blanked (#1391).
    A refused report (`report`, `embed_session`, `embed_open`, `report_open`) logs one
    `dash_report_refused` line with the person, the report key and the reason (`no_access`,
    `no_reach` for a reader who reaches nothing yet, `not_your_store`, `whole_stores_only`,
    `report_not_set_up`), and the page says why in plain words, never "couldn't open" (#1423).

  `stores`, `report` and `embed_session` are `person_scope` reads for the three app roles.
- **Settings:** `embed_service_account` (optional: without it a report says "This report couldn't
  open"), `linked_tables`; the secret `MOTHERDUCK_TOKEN` (every read answers
  "not set up" while it is missing); `frameOrigins: ["https://embed-motherduck.com"]`.
- **Embed sessions use their own token** (#1139, [ADR 0022](../../../adr/0022-dive-embed-sessions-have-their-own-token.md)).
  The optional secret `MOTHERDUCK_EMBED_TOKEN` is handed only to `embed_session` and `embed_open`,
  and it is the only token the embed-session call sends. It holds the token of
  `motherduck_dive_service_account`, the MotherDuck account that reads and writes Dives and may
  create Dive embed sessions (the Admin preset role has that permission). The service
  account in `embed_service_account` needs only access to the Dive and its data. `MOTHERDUCK_TOKEN`
  stays the warehouse's read-only token: every other read uses it, and it can't
  create embed sessions. While `MOTHERDUCK_EMBED_TOKEN` is unset, the two embed reads answer "not set
  up", MotherDuck isn't called, and the page says "This report couldn't open".
  There is deliberately no fallback to `MOTHERDUCK_TOKEN`: on production that is the account
  MotherDuck refuses (HTTP 403), and a fallback would hide the missing setup.

## Releasing a Dive

Save the new version on MotherDuck; the next reader sees it. Nothing here names a version. Before
saving, check the version still applies the filters its `dash.report` row sends and offers no picker
beyond them, then check the real embed on dev, and whether the ready message arrives; only then set
`ready_signal` on the row. The ready message is `{ type: "dash:dive-ready" }`, posted to the parent
window. Dash also accepts the legacy `{ type: "feather-dash:dive-ready" }` that Dives published before
#966 still post (#1141). Either counts only from `https://embed-motherduck.com` and the Dive's own frame.

**Known interim on an app address.** Until featherbase's cut-over retires
today's Sales Target page (design D8, B9), the platform routes an address that
opens `dash` to that page (`INTERIM_APPS` in featherbase's
`packages/shared/src/app-routes.ts`). The app itself is served at
`/dash/` on the Admin address, and on a dev machine with
`INSTANCE_ADDRESSES` unset.
