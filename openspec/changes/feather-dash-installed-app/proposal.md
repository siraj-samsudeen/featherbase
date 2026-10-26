## Why

Feather Dash is the staff reporting product: each manager opens the sales-target
report for their own sections and, later, corrects their own section data. Today it
is a page built into Featherbase's own web app, and its query names one client's
warehouse. Both web addresses (`dash.<domain>` and `featherbase.<domain>`) open the
same instance, nothing routes by address, and the product calls itself
"Featherbase".

The instance owner decided on 24-Oct-2026 (#458) that Featherbase is the
master-data system and Feather Dash is an app installed on top of it, as Tasker is.
On 26-Oct-2026 the owner recorded [ADR 0011](../../../docs/adr/0011-platform-app-instance.md):
platform, app and instance are separate layers, and each knows only the layer below
it. Feather Dash is the first app designed against it.

## What Changes

- **Feather Dash becomes a generic app in this repository** (`feather_dash`),
  installed and upgraded like Tasker. It names no client.
- **A client's report is instance setup**, kept in the client's private repository:
  the report's query, its MotherDuck Dive, and which jobs may use the app.
- **Addresses.** One list, `INSTANCE_ADDRESSES`, says what each address opens and
  which one emails use. It replaces `SITE_URL`. The Feather Dash address opens
  Feather Dash directly; the Featherbase address opens the Admin screens. Anyone who
  signs in at an address with nothing for them is handed to the right one.
- **One top bar on every address**, with Sign-in methods and Log out in the Account
  menu. Apps may declare controls for it, such as Feather Dash's store picker.
- **The Dive is the report.** Cached numbers show inside it at once, and the reader
  chooses when to switch to the live numbers.
- **Platform extensions, each generic:**
  - a fixed shape for "which places a person covers", filled by a swappable roster
    provider;
  - declared settings and secrets;
  - report definitions supplied by the instance;
  - declared outside sites;
  - reads that call out after the authorization transaction;
  - app roles bound to jobs through an Admin-editable setting;
  - declared bar controls;
  - a release guard that refuses to start when an installed app's version is missing;
  - the platform version an app was built for, replacing `apiVersion`.
- **A staged migration.**
  - (A) addresses and the shared bar around today's page;
  - (B) the generic app, with the client's report moved to the client's repository;
  - (C) adopt the roster redesign (#449);
  - (D) section editing, after #462.
- **BREAKING:**
  - `SITE_URL` is removed (stage A);
  - the core route `/featherbase/sales-target`, the `/api/sales_target/*` endpoints
    and the core dataset module are removed (stage B, after cut-over);
  - `apiVersion` becomes `platformVersion` (stage B);
  - the `Sales Target Viewer` role is removed (stage C).

## Capabilities

### New Capabilities

- `front-doors`: addresses that each open one thing, a hand-off to the right
  address, and one top bar everywhere.
- `feather-dash`: the Feather Dash app. Managers open their own sales-target report
  and raise changes to their own section data; a reviewer applies them.

### Modified Capabilities

- `trusted-runtime-packages`: an app accepts a report definition from the instance,
  declares its settings, secrets, outside sites and bar controls, states the platform
  version it was built for, and a deploy never silently removes an installed app.
- `app-roles-store-access`: apps read a person's scope in one shape, whatever the
  roster looks like, and an app's roles follow people's jobs.

## Impact

- **Server:** `runtime-packages.ts`, `runtime-actions.ts`, `app-access.ts`,
  `dataset-snapshot.ts`, `runtime-shell.ts`, `config.ts` and `index.ts` (addresses,
  landing, OAuth, CSP), `security-tables.ts`, `release-preflight.ts`, and a new scope
  provider that takes today's derivation out of `sales-target.ts`. `sales-target*.ts`
  and `datasets/sales-target-mtd.ts` are deleted at the end of stage B.
- **Web:** a shared top bar replaces the separate headers in `SalesTarget.tsx`,
  `RestrictedShell.tsx` and `Portal.tsx`. `SalesTarget.tsx` and `lib/api.ts`
  `landingPath` retire. The login page reads the brand per address.
- **New app:** `runtime-apps/feather-dash`, built into the image as Tasker is.
- **Deployment:** `INSTANCE_ADDRESSES` replaces `SITE_URL`, with one Google redirect
  per address. The Dive settings move from the environment into app settings, set by
  the client's instance install. `docs/DEPLOY.md` is corrected: prod deploys from
  `main`.
- **Client repository:** gains the report definition, the Dive's few lines for cached
  rows, and the job bindings.
- **Depends on** #449 and #392 (stage C), #462 (stage D), #487 (before stage A
  reaches prod). #310 must drop its Feather Dash fixtures.
