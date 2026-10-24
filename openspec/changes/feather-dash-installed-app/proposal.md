## Why

Feather Dash is the staff reporting product: each manager opens the sales-target
report for their own sections and, soon, corrects their own section data. Today it
is a page built into Featherbase's own web app. Both web addresses
(`dash.<domain>` and `featherbase.<domain>`) open the same instance, nothing routes
by address, and the product calls itself "Featherbase".

The instance owner decided on 24-Oct-2026 (#458) that Featherbase is the
master-data system, and that Feather Dash is a reporting app installed on top of it,
as Tasker is. Staff should open the Feather Dash address and land straight in
Feather Dash, under its own name, and never see the admin Desk. The report must keep
working for the people using it today while this changes.

## What Changes

- **Front doors.** An instance can point a web address at one installed app, as
  configuration. On `dash.<domain>`, a signed-in person goes straight into Feather
  Dash, inside a staff shell that carries Feather Dash's name and has no Desk menus.
  `featherbase.<domain>` stays the Desk. Sign-in works on both addresses, and Google
  sign-in returns to the address it started on. A person with no Desk access who
  signs in on the Desk is handed over to their front door.
- **Feather Dash becomes a runtime package** (`feather_dash`), installed and upgraded
  like Tasker. It carries the report page, the store switcher, the report's server
  reads (identity, embed session, report), the report dataset's definition, the embed
  settings and its roles. Later it also carries section-change requests.
- **The smallest platform extensions that make this possible:**
  - the caller's scope (stores, sections, subcategories), supplied by the platform as
    an operation policy, so every app reads one answer;
  - declared settings and secrets;
  - package-defined datasets on the platform's snapshot engine;
  - declared frame origins for embedded content;
  - roles an app declares, bound to people's jobs;
  - a deploy guard that refuses to start when an installed app's exact version is
    missing.
- **A staged migration.** (A) front door around today's page; (B) move the code
  into the package, then delete the core page; (C) adopt the roster redesign
  (#449): scope and job roles come from `position`; (D) section editing. Each stage
  can be rolled back until its clean-up step.
- **BREAKING (stage B, after cut-over):** the core route `/featherbase/sales-target`,
  the `/api/sales_target/*` endpoints and the core dataset module are removed. In
  stage C, the `Sales Target Viewer` role is removed.

## Capabilities

### New Capabilities

- `front-doors`: a web address that opens one installed app directly, with its own
  name, its own sign-in and a staff shell.
- `feather-dash`: the Feather Dash app. Managers open their own sales-target report
  and raise changes to their own section data; a reviewer applies those changes.

### Modified Capabilities

- `trusted-runtime-packages`: a package can bring its own report data, declare its
  settings, secrets and embedded sites, and a deploy never silently removes an
  installed app.
- `app-roles-store-access`: an app reads the person's scope from what they are
  responsible for, and an app's roles follow people's jobs.

## Impact

- Server: `runtime-packages.ts`, `runtime-actions.ts`, `app-access.ts`,
  `dataset-snapshot.ts`, `runtime-shell.ts`, `index.ts` (host routing, sign-in
  landing, OAuth, CSP), `security-tables.ts`, `release-preflight.ts`. Also a new
  person-scope provider, which takes today's derivation out of `sales-target.ts`.
  `sales-target*.ts` and `datasets/sales-target-mtd.ts` are deleted at the end of
  stage B.
- Web: `SalesTarget.tsx`, `RestrictedShell.tsx` (`ReportOnlyShell`), `router.tsx`
  and `lib/api.ts` `landingPath` move or retire. The login page reads the brand per
  address.
- New package: `runtime-apps/feather-dash`, built into the image as Tasker is.
- Deployment: a front-door setting per instance, one more Google redirect address per
  front door, and the Dive settings move from environment and shared files into app
  settings.
- Depends on #449 (roster redesign) and #392 (job roles) for stages C and D. Fits
  #441/#443/#437 (system-written and security tables) as described in the design.
