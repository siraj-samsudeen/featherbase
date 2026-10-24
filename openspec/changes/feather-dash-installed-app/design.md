## Context

The decision in #458 is fixed. Featherbase is the master-data system. Feather Dash
is a reporting app installed on top of it, the way Tasker is. This design sets out
how to get there without the live report ever breaking.

**Today (main at `af79470e`, 24-Oct-2026):**

- **The report is core code.** The page is `apps/web/src/pages/SalesTarget.tsx` at
  `/featherbase/sales-target`. The server side is `apps/server/src/sales-target.ts`
  (scope derivation, embed-session minting, the `/api/sales_target/{me,embed_session,report}`
  routes, the `Sales Target Viewer` gate) plus `sales-target-report.ts` (shaping
  over the snapshot or the live read) and `datasets/sales-target-mtd.ts` (the dataset
  SQL, its loader and its validation). The dataset is registered with the generic
  snapshot engine `dataset-snapshot.ts` and refreshed by the `refresh_datasets` job.
- **The embed config is read from scattered places.** `DIVE_ID`, `DIVE_VERSION` and
  `SERVICE_ACCOUNT` come from the process environment, or else from a shared
  `.env.local` path (`SALES_TARGET_SHARED_ENV`) left over from the experiment. The
  token (`MOTHERDUCK_TOKEN`) comes only from the environment. The CSP allows
  `EMBED_ORIGIN` as a frame source on every page.
- **Scope is derived in the report's own module.** `currentAssignments` reads the
  person's current employee-code identifiers and nine Excel-born tables
  (`Section Merchandise Map`, `Employee Section Map`, `Section Ownership`,
  `Section Name Alias`, `Store Manager`, `Sales Target Assignment`, …). It returns
  one assignment per store: sections, material groups and the basis for each.
  These tables are listed in `SECURITY_TABLES` (#437), so only a System Manager
  writes them, whatever the Permission rows say.
- **Landing is decided by role.** `landingFor` sends a holder of `Sales Target Viewer`
  to the report after every sign-in route. The web app picks `AdminLayout`,
  `ReportOnlyShell` or `NoAccessPage` from the capabilities `whoami` returns
  (`capabilities.report` is that role check). Portal is a separate shell for
  web-form users.
- **Hosts are not distinguished.** `SITE_URL` is the instance's one trusted origin.
  It is used for emailed links (invitations, password reset, the waiting-for-access
  alert), for the Google `redirect_uri` and for the cookie's `Secure` decision. The
  sid cookie is host-only. The bearer token lives in that origin's storage.
  `tenancy.ts` `resolveSite` maps a Host to a *separate schema-per-site tenant*,
  and nothing in the report path uses it.
- **Runtime packages already run server code.** A package's `featherbase.json`
  declares owned Tables, permissions, migrations, `actions` and `reads`. Its compiled
  `server.mjs` exports `actions`, `reads`, `validators`, `scopeResolvers` and
  `authorizers`. The code is trusted: importing it grants full Node privileges, and
  there is no sandbox. Operations carry a policy, either `table` or `stores` (an
  app-owned store dimension filtered by Data Scope rows), plus an optional product
  authorizer. Every read and action re-checks roles and scope fresh, inside one
  transaction (`app-access.ts`). Install, preview-upgrade, upgrade (bound to a plan
  ID) and activate are operator API calls. Discovery selects the *installed exact
  version*, never the newest one. Upgrades may add optional columns and withdraw
  grants (#437). They refuse new Tables and new or wider grants. Every runtime
  client is wrapped in the #309 host bar, which has a Home icon and an app switcher.
  #309 deliberately has no manifest "presentation mode".

**What the runtime package system lacks for Feather Dash:**

| Need | Today |
|---|---|
| The caller's scope from master data the app does not own | Facts and store dimensions must be app-owned Tables |
| Settings and secrets | Nothing declared; a module can read `process.env` because it is trusted, which is invisible to review |
| A scheduled snapshot dataset | Datasets register only from core code; packages declare no jobs |
| A frame source for an embed | The CSP is global and core-owned |
| An outbound network call inside a read | Reads run inside the authorization transaction, so row locks would be held across the call |
| Roles that follow jobs | Roles are names on people, and upgrades can never widen a grant |
| A front door by address | None |

**Related work this must fit:**

- The roster redesign #449 (owner decisions 23-Oct-2026), with its dossier in the
  private warehouse repo. Four tables replace the nine: `section`,
  `section_subcategory`, `position` (person, job, store, floor, section, from, to)
  and `value_mapping`. Scope comes from current `position` rows: a Store Manager gets
  the whole store, a Floor Manager every section on their floor, and a Department
  Manager, Team Leader or Staff member the named section. Job roles (#392) are
  granted from current `position` rows. At launch they go to managers only. The
  `Sales Target Viewer` role and `sales_target_assignment` go away.
- Security #441/#443/#437. Audit tables are written by the system only, and access-
  deciding tables are written by a System Manager only. `position` and
  `value_mapping` decide scope, so #449 writes them as System Manager only, or as a
  named writer role such as a Data Quality Manager.

## Goals / Non-Goals

**Goals:**

- Feather Dash ships, installs and upgrades as a runtime package. Featherbase core
  holds no report-specific page, route, dataset or role.
- `dash.<domain>` opens Feather Dash directly, under its own name, and
  `featherbase.<domain>` stays the Desk. Which address opens which app is set in
  configuration, never in code.
- Scope is a platform answer derived from master data, so the next report (a
  scorecard, an inventory view) reuses it without copying 250 lines.
- Managers raise changes to their own section data from Feather Dash without
  weakening the security-table rule.
- Every stage is small, reversible until its clean-up step, and keeps the live report
  working.

**Non-Goals:**

- Implementing #449's tables, the import that remembers human edits, or roster sync.
  This design only consumes them.
- The Data Review app (warehouse epic item A5) and the "Dash home lists every report
  and master" page (item C3). Feather Dash leaves room for both.
- Sandboxing package code. Packages stay trusted and reviewed. The declarations below
  serve review and preflight, not containment.
- Multi-tenancy. A front door is another address for the same instance and the same
  data, not a site.

## The picture

```
                 browser                                  browser
         https://dash.<domain>                    https://featherbase.<domain>  (= SITE_URL)
                   │                                          │
                   ▼                                          ▼
   ┌──────────────────────────── one Featherbase instance (one server, one database) ─────────────────────────┐
   │  Front-door routing: Host → configured door? ── yes → door shell, door brand, door sign-in, door landing  │
   │                                               └─ no  → the Desk (Admin UI, #309 host bar for apps)       │
   │                                                                                                          │
   │   Installed apps (runtime packages)                                                                      │
   │   ┌──────────────────────────────────────────┐   ┌──────────────┐                                         │
   │   │ Feather Dash  (feather_dash)             │   │ Tasker       │   … later: Store Layout, Data Review    │
   │   │  client: report, store switcher,         │   └──────────────┘                                         │
   │   │          my sections, review queue       │                                                            │
   │   │  server: reads me / embed_session /      │                                                            │
   │   │          report; actions request /       │                                                            │
   │   │          decide section change           │                                                            │
   │   │  dataset: sales_target_mtd definition    │                                                            │
   │   │  owns: section change requests           │                                                            │
   │   └───────────────┬──────────────────────────┘                                                            │
   │                   │ stable platform APIs (operation policies, context capabilities)                      │
   │   ┌───────────────▼──────────────────────────────────────────────────────────────────────────────────┐   │
   │   │ Platform: sign-in & sessions · people & identifiers · person scope (today: nine tables;          │   │
   │   │ after #449: position + section + section_subcategory) · job roles & app-role bindings ·          │   │
   │   │ security tables (#437) · dataset snapshot engine + refresh job · Access Log · app settings &     │   │
   │   │ secrets · CSP · install / upgrade planner · release preflight                                    │   │
   │   └──────────────────────────────────────────────────────────────────────────────────────────────────┘   │
   └──────────────────────────────────────────────────────┬───────────────────────────────────────────────────┘
                                                          │ outbound (token from a declared secret)
                                                          ▼
                                       MotherDuck: embed sessions, the Dive, the warehouse
```

## Decisions

### D1. The app boundary: product logic moves; master data and its meaning stay

| Piece | Goes to | Why |
|---|---|---|
| Report page, store switcher, empty/error states, the "remembered store" convenience | **Feather Dash client** | Product UI |
| `me`, `embed_session`, `report` endpoints | **Feather Dash reads** (`/api/app_reads/feather_dash/<read>`) | Product behaviour. Each is a read: none changes data |
| The IST month-to-date period, the Dive's initial-state shape, the embed-session call | **Feather Dash server module** | Specific to MotherDuck and the Dive |
| `sales_target_mtd` SQL, row validation, report shaping and totals | **Feather Dash dataset + read** | The app's own query |
| Dive ID, Dive version, service-account name | **Feather Dash settings** (E2) | Instance configuration, not code |
| `MOTHERDUCK_TOKEN` | **A declared secret** (E2), still an environment variable | A secret never goes into a table |
| The frame origin for the embed | **Declared by the app** (E4) | Only the app's own documents need it |
| Who may open it, who may request or review section changes | **App roles** (D4) | The app declares them; the instance binds jobs to them |
| Section-change requests | **A Feather Dash-owned Table** (D5) | The app's own workflow data |
| Sign-in, sessions, people, identifiers | Platform | Shared by every app |
| **Scope derivation** (person → stores → sections → subcategories, with the basis for each, and the "ambiguous code means no scope" rule) | **Platform person-scope provider** (E1) | Master data and what it means. Featherbase is the MDM, and every report needs the same answer |
| The nine roster tables, and later `section`, `section_subcategory`, `position`, `value_mapping` | Platform (instance master data) | Owned by the MDM, not by one report |
| Snapshot engine: registry, build/validate/activate, retain last good, misses, refresh job | Platform | Already generic (#281) |
| Access Log of who opened which report from which snapshot | Platform-written (#441) | Audit is system-written |
| Front-door routing, door shell, door brand | Platform (D3) | Chosen by address, not by the package (see the #309 note) |

**Where an app's server code lives.** It lives in the package: `runtime-apps/feather-dash/src/server.ts`
is bundled to `dist/server.mjs`, as Tasker's is. Runtime apps already support
server code (actions, reads, validators, scope resolvers, authorizers). The missing
pieces are listed in D2.

### D2. The smallest platform extensions

Each extension is generic. None names Feather Dash, and each one is useful to the
next reporting app.

**E1. A `person_scope` operation policy.** It sits beside `table` and `stores`.

- Declaration: `{ "policy": { "kind": "person_scope", "readRoles": [...], "actionRoles": [...] } }`.
- The platform computes the caller's current scope fresh on every request. The
  scope is a list of stores. For each store it gives the sections, the merchandise
  codes in each section, and the basis (`section_staff`, `team_leader`,
  `department_manager`, `floor_manager`, `store_manager`, and `assignment` until #449
  removes it). The platform hands the scope to the handler frozen, in
  `authorization.scope`.
- The payload may name one `store` and, for actions, one `section`. The rules are
  those of the `stores` policy. Naming anything outside the caller's scope refuses
  the *whole* request, records the refusal in the Access Log, and reveals nothing. An
  empty scope is never read as all stores, including for an administrator.
- **Provider.** Stage B moves today's `currentEmployeeCodes`, `derivedFromSections`
  and `sectionsOf` *unchanged* into a platform module, `person-scope.ts`. Stage C
  replaces its body with the `position` derivation (#449). The policy's output shape
  stays the same, so the app does not change at stage C. That is the reason for this
  boundary.
- Rejected: an app-owned scope Table filled from master data. It copies the MDM
  into every app, and the copies drift. Also rejected: letting a package's scope
  resolver read platform tables. That gives each app its own reading of who-leads-what,
  and widens the `facts` capability to tables the app does not own.

**E2. Declared settings and secrets.**

- Manifest: `"settings": [{ "name": "dive_id", "label": "Dive", "required": true }, …]`
  and `"secrets": ["MOTHERDUCK_TOKEN"]`.
- Settings values live in a platform `App Setting` Table keyed by app and name. It is
  a security Table, so only a System Manager writes it. The instance's own config
  repo can set the values through fixtures, as it sets `app_name` today. Secrets stay
  environment variables and are never stored, logged or returned.
- Handlers receive `context.settings` and `context.secrets`, holding only what was
  declared. A missing required value gives the app's own "not configured" answer
  (today's `not_configured` marker). It is not an error. The release preflight warns
  when an installed, enabled app lacks a required secret. It does not refuse,
  because a deployment may serve the snapshot-only report on purpose.
- This retires `SALES_TARGET_SHARED_ENV`, `readSharedEnv`, `TEST_ACCOUNTS` and
  `seedSalesTarget`'s password seeding. Those are experiment scaffolding. Tests set
  settings directly.
- Not a sandbox. A trusted module could still read `process.env`. The declaration
  makes what a package needs visible to review and to preflight.

**E3. Package datasets.**

- Manifest: `"datasets": { "sales_target_mtd": { "columns": [{ "name": "plant_code", "type": "text" }, …], "keys": ["plant_code", "hierarchy_code"] } }`.
  A dataset may have more than one row kind. Today's day rows and name rows become
  two declared datasets, or one dataset with a `kind` key. That choice is left to
  implementation.
- Module: `export const datasets = { sales_target_mtd: { version(ctx), fetch(ctx), validate(rowCount, previous) } }`.
  `fetch` receives the declared settings and secrets. The platform does the load. It
  writes typed rows into storage it creates in the app's schema. That storage is a
  raw relation, never a Table, and never reachable through the list, document or
  export APIs. This keeps today's rule that the snapshot holds every store's figures
  and is read only through a scope-checked path (#246).
- The existing engine runs the lifecycle unchanged: build the candidate, run the
  app's `validate`, activate atomically, keep the last good snapshot, record misses,
  refresh on the `refresh_datasets` schedule. On deploy it registers only the
  datasets of installed, active packages.
- Reads get `context.datasets.active(name)`. It returns the snapshot's identity
  (ID, source as-of, refreshed at) and `rows({ where })`, filtered by equality or
  `in` on declared keys only. The app does its aggregation in code. The largest
  reader (a whole store, about a month of days) is a few tens of thousands of rows,
  which is cheap. No SQL crosses from the app to the platform.
- The storage is a rebuildable cache. When the definition version or the columns
  change, an upgrade may reshape it with no migration: the old snapshots are
  dropped, the next refresh rebuilds, and the app's live read covers the gap (as it
  does on the 1st of every month today).

**E4. Declared frame origins.** Manifest `"frameOrigins": ["https://embed-motherduck.com"]`.
The platform adds them to `frame-src` only on that app's own documents. The global
`EMBED_ORIGIN` entry goes away. The browser-level stub keeps working through a
`frame_origin` setting, which only a System Manager can set and which is allowed only
in development or test.

**E5. Reads that call out.** A read declared with `"outbound": true` has its
authorization decided and frozen inside the platform transaction, as today. Its
handler then runs *after* that transaction closes, so no row lock or pooled
connection is held during a MotherDuck call. Handlers also get
`context.recordView({ reference, method })`. It writes the Access Log row (the
platform writes it, as #441 requires) and replaces today's direct `logAccess` call.

**E6. App roles bound to jobs** (stage C, D4).

**E7. The deploy guard.** The release step (`pnpm --filter server release`) refuses
when an *installed and enabled* runtime package's exact installed version is not
among the discovered artifacts. Today that case only makes the app unavailable at
runtime. For Feather Dash it would take the live report away silently on deploy. A
refused release keeps the previous deployment serving.

### D3. Front doors by address

**Configuration.** A System Settings field `front_doors` holds a list:

```json
[{ "address": "https://dash.example.com", "app": "feather_dash", "name": "Feather Dash" }]
```

The instance sets it from its own config repo, like `app_name`. It is never
hard-coded. Validation:

- `address` is an absolute `https` origin outside development and test;
- its host differs from `SITE_URL`'s host and from every other door's host;
- `app` names a runtime package.

A door whose app is not installed, or disabled, shows the existing "Application
unavailable" page. It never falls back to the Desk. The release preflight checks the
same rules.

**Matching.** The request's `Host` (lowercased, port stripped) is compared exactly
with the configured door hosts. No match means today's behaviour. The header can
only *select* a configured door. Every absolute URL the server builds (redirects,
`redirect_uri`, emailed links) comes from configuration, never from the header. This
keeps the rule in `externalOrigin` and `SITE_URL`. `tenancy.ts` sites are rejected
for this: they are separate schemas with separate data, while a door is the same
instance.

**Routing on a door host.**

- `/` redirects to the app's root, `/feather_dash/`. Each app keeps one URL scheme on
  every host, which is simple and needs no change to package base paths. Serving the
  app at the door's root is possible later, without breaking links, if the path
  looks wrong to the owner.
- These are served as usual: `/featherbase/login`, `/featherbase/reset-password`,
  `/featherbase/oauth-callback`, `/privacy`, `/api/*`, the runtime-shell assets and
  the app's own root.
- Every other `/featherbase/*` page (admin, form, portal, print) and every other
  app's root redirects to the door's root. The Desk is not reachable on a door host.
- **A door is presentation, not a security boundary.** Every API call is authorized
  on its own merits on every host, and the design never relies on the redirects for
  access control.

**The door shell.** A door's documents get a *door shell* instead of the #309 host
bar. It shows the door's name and mark, the signed-in person's display name and
sign-out. It has no app switcher and no Desk menus. A person who can use the Desk
(the `manage` or table-access capability) also gets one "Open the Desk" link to
`SITE_URL`. #309 rejected a *package-chosen* presentation mode. Here the *address*
picks the shell, an instance setting the package cannot influence. On the Desk host,
Feather Dash still opens with the normal #309 bar, so a System Manager can reach it
from the Desk.

**Branding.** `/api/brand` answers with the door's `name` on a door host and with
`app_name` otherwise. The login page, the document title and the door shell use it.
`MAIL_FROM` and `app_name` are unchanged.

**Sign-in and sessions.**

- **One sign-in per address.** The sid cookie stays host-only. The bearer token
  stays in that origin's storage. Both hosts use the same server-side sessions, and
  signing out on one host ends only that host's session (#411 behaviour per
  session).
  - Rejected: a parent-domain cookie (`Domain=.<domain>`). It would expose a live
    credential to every subdomain, including unrelated services on the same domain,
    and it still would not share the bearer token.
  - Cost: an administrator signs in once on each address. Staff use only one address.
- **Password, StyleHR (delegated) and sign-up** are same-origin POSTs and work on any
  host unchanged.
- **Google.** When sign-in starts on a door, the `redirect_uri` is
  `<door address>/api/oauth/google/callback`. The OAuth `state` records the door, and
  a callback that arrives on another host is refused. Each door address must be
  registered as an authorized redirect on the Google client (a deployment step).
- **Landing.**
  - On a door, the landing is always the door's app.
  - On the Desk, the landing is the Desk. The exception is a person who has no Desk
    capability but can open a door's app. They are handed to that door. The handoff
    is a one-time, one-minute code that names the target door and mints a *new*
    session for it. The door's `/featherbase/oauth-callback` redeems it. Unlike #150's
    handoff, it is not bound to the minting host's cookie, because that cookie cannot
    cross hosts. It is bound to the target door instead.
  - This replaces `landingFor`'s role check, `capabilities.report` and
    `ReportOnlyShell`.
- **Emails** keep linking to `SITE_URL` (Q3). A staff member who follows an invitation
  or a reset link signs in on the Desk address and is handed to Feather Dash. The
  link does not have to guess the person's door, and `SITE_URL` stays the one origin
  the preflight requires.

**What a System Manager sees on dash.** The same Feather Dash, under the same rules.
Their report covers *their own* scope. An administrator role is never read as all
stores (`app-roles-store-access`), so a System Manager with no position sees "no
sections yet". They also get the "Open the Desk" link. Checking what a particular
manager sees ("see as this person") is a separate feature with its own audit
questions. It is out of scope here and filed as a follow-up.

### D4. Roles: the app declares what it needs; people hold jobs

**Feather Dash declares three app roles in its manifest:**

| App role | Lets a person |
|---|---|
| Feather Dash Reader | open the report for their own scope |
| Feather Dash Section Editor | raise change requests for sections in their own scope |
| Feather Dash Section Reviewer | see every open request and apply or reject it |

**People are never given these roles by hand.** A person holds jobs (Store Manager,
Floor Manager, Department Manager, Team Leader), which the system grants from current
`position` rows (#392, #449). A person may also hold function roles, such as
Data Quality Manager or System Manager. An **app-role binding** says which jobs and
roles carry each app role:

- **The bindings Table.** A new platform security Table, `App Role Binding` (app
  role, granted through role). Only a System Manager writes it. The release preflight
  refuses a binding to `All` or `Guest`.
- **Manifest defaults.** `"roleDefaults": { "Feather Dash Reader": ["Store Manager", "Floor Manager", "Department Manager", "Team Leader"], "Feather Dash Section Editor": [same], "Feather Dash Section Reviewer": ["Data Quality Manager"] }`.
  The defaults are written as binding rows at install time. After that, an
  instance's System Manager may change them, and an upgrade never re-imposes them.
  The scheduled job's cadence works the same way. Widening the audience (say, Staff
  later) is therefore an instance decision, not an app release. The upgrade planner's
  "never widen a grant" rule still holds, because a binding is not a package grant.
- **The role check.** Both role-policy checks (`readRoles`/`actionRoles`) and Table
  permissions treat a person as holding an app role if they hold it directly or hold
  any role bound to it. The check runs fresh on every request.
- **Answering #392's question.** "What can a Store Manager do?" is now one query over
  the bindings. A person's role list shows jobs, and the app roles appear only as
  what each job carries.
- **Rows come from scope, never from roles.** A Team Leader and a Store Manager hold
  the same Reader role and see different rows.

**Before stage C.** No jobs exist yet, so the default binding is
`Sales Target Viewer → Feather Dash Reader`. The roughly 40 trial users keep access
with no role edits. Stage C replaces it with the job bindings and deletes
`Sales Target Viewer`.

### D5. Section-data editing: requests in the app, writes by a reviewer

**The section data a manager can affect, after #449:**

| Table (#449) | What a manager may ask to change | Never |
|---|---|---|
| `section` | floor, line of business, "this section's list is confirmed" | create or delete a section, rename it, change its store |
| `section_subcategory` | move a subcategory into or out of one of their sections, or mark the mapping wrong | edit mappings of sections outside their scope |
| `position` (Staff rows only) | add or end a Staff placement in one of their sections | any manager's position (SM, FM, DM, TL), their own position |

All three Tables decide scope. They are security Tables (#437): only a System Manager,
or the named writer role #449 settles on (for example Data Quality Manager), writes
them. **This design adds no exception to that rule.**

**The model.**

- **A request Table.** Feather Dash owns `feather_dash.section_change`. Its columns:
  store, section, kind (`confirm_section`, `move_subcategory_in`,
  `move_subcategory_out`, `add_staff`, `end_staff`, `correct_section_detail`, `note`),
  subject (a subcategory or a person), proposed value, reason, status (`open`,
  `applied`, `rejected`, `withdrawn`), decided by, decided at, decision note.
- **Raising a request.** Action `request_section_change`. Policy `person_scope`,
  actionRoles `[Feather Dash Section Editor]`. The payload names store and section,
  and the platform refuses any section outside the caller's scope (E1):
  - a Team Leader or Department Manager gets their named sections;
  - a Floor Manager gets every section on their floor;
  - a Store Manager gets the whole store.

  A move between two sections names both. It is accepted if *either* section is in
  the requester's scope, and the reviewer sees both sides. Requesters read their own
  requests (`own_rows_only`). They withdraw a request only while it is open.
- **Deciding a request.** Action `decide_section_change`. Policy `table`, actionRoles
  `[Feather Dash Section Reviewer]`. Applying a request writes the master rows *as
  the reviewer* through the normal save path. #437's writer check passes only
  because the reviewer holds the writer role. Version history and #449's "imported
  rows remember human edits" keep the change across later imports. The request row
  records the decision. To do this, the manifest declares the three master Tables in
  `actions.tables` with reviewer write grants. The platform already allows a declared,
  permissioned, non-owned instance Table, and refuses another app's Tables.
- **What the screens show.** Feather Dash's "my sections" page lists each section in
  scope with its subcategories, each marked *confirmed* or *assumed* (the warehouse
  epic's item A4), plus any open requests. The data comes from E1: from stage D, each
  scope entry also carries the section's and each mapping's confirmation status, so
  managers need no read grant on the master Tables. The reviewer page lists every
  open request, grouped by store.

**Rejected:**

- **Direct writes by managers.** This needs a hole in #437. A subcategory move also
  changes *another* section's scope, which belongs to another person.
- **Desk grants plus Data Scope rows.** Data Scope restricts by a value list on one
  Table. It cannot express "sections your position names, and the subcategories
  under them". It would also hand managers the Desk.

Q2 asks the owner to confirm the review step.

### D6. Packaging, versions, install and upgrade

**The package.** `runtime-apps/feather-dash/`:

- `package.json`, with version `1.0.0` at first install;
- `featherbase.json`, the manifest (sketch below);
- `src/` (client: Vite + React; server: `src/server.ts` bundled to `dist/server.mjs`);
- `dist/client`.

The client uses the Shop Floor tokens and components. It imports them at build time
from a small workspace package extracted from `apps/web`, so the design guards apply
to it as well. Tasker's current copy is not repeated.

```json
{
  "manifestVersion": 1, "apiVersion": 1,
  "name": "feather_dash", "title": "Feather Dash",
  "server": "dist/server.mjs", "client": "dist/client",
  "entryTable": "feather_dash.section_change",
  "roles": ["Feather Dash Reader", "Feather Dash Section Editor", "Feather Dash Section Reviewer"],
  "roleDefaults": { "Feather Dash Reader": ["Sales Target Viewer"] },
  "settings": [{ "name": "dive_id", "required": true }, { "name": "dive_version", "required": true },
               { "name": "embed_service_account", "required": true }],
  "secrets": ["MOTHERDUCK_TOKEN"],
  "frameOrigins": ["https://embed-motherduck.com"],
  "datasets": { "sales_target_mtd": { "columns": ["…"], "keys": ["plant_code", "hierarchy_code"] } },
  "reads": { "version": 1, "tables": ["feather_dash.section_change"], "operations": {
    "me":            { "policy": { "kind": "person_scope", "readRoles": ["Feather Dash Reader"], "actionRoles": [] }, "authorization": { "kind": "generic" } },
    "report":        { "policy": { "kind": "person_scope", "readRoles": ["Feather Dash Reader"], "actionRoles": [] }, "authorization": { "kind": "generic" } },
    "embed_session": { "policy": { "kind": "person_scope", "readRoles": ["Feather Dash Reader"], "actionRoles": [] }, "authorization": { "kind": "generic" }, "outbound": true },
    "my_sections":   { "policy": { "kind": "person_scope", "readRoles": ["Feather Dash Section Editor"], "actionRoles": [] }, "authorization": { "kind": "generic" } }
  } },
  "actions": { "version": 2, "tables": ["feather_dash.section_change", "section", "section_subcategory", "position"], "operations": {
    "request_section_change": { "policy": { "kind": "person_scope", "readRoles": [], "actionRoles": ["Feather Dash Section Editor"] }, "scope": { "kind": "request" }, "authorization": { "kind": "generic" } },
    "decide_section_change":  { "policy": { "kind": "table" }, "authorization": { "kind": "generic" } }
  } },
  "tables": [{ "name": "feather_dash.section_change", "label": "Section change request", "columns": ["…"] }],
  "permissions": ["…own-rows create/read for Section Editor; read/write for Section Reviewer; reviewer write on the three master Tables…"]
}
```

The entry Table is the request Table, because a runtime package must own at least
one Table and name an entry Table. The app catalog shows Feather Dash to anyone who
can read it, so the Reader role gets an own-rows read grant on it. That grant shows
nothing until the person raises a request.

**Versions.**

- Code-only changes are patch or minor versions with an empty migration
  (`operations: []`).
- A new optional column is an `addColumn` migration.
- A new Table or a wider grant is refused by the upgrade planner. So **1.0.0 already
  declares the request Table and every grant that stage D needs**, even though stage
  B ships no section screens. Extending the planner to add Tables is deliberately
  left out of this design.

**Delivery.**

- The Dockerfile builds `runtime-apps/feather-dash` as it builds Tasker.
- The image also ships every version that is currently installed on any instance
  (the predecessor-fixture pattern of `runtime-apps/fixtures/tasker-v2.2`).
- `FEATHERBASE_APP_PATHS` lists both versions.
- E7 makes a missing installed version a refused release, not a silent outage.

**Dev and prod.** The brief says prod auto-deploys from main. `docs/DEPLOY.md` says
prod deploys the `production` branch, with the owner's approval. The design holds
either way: **a deploy never upgrades an app.**

1. **Merge.** A merge to main ships the new artifact to an instance.
2. **Nothing changes.** Discovery keeps serving the installed exact version, and
   users see no change.
3. **Upgrade on dev.** A System Manager runs preview → upgrade (plan ID) →
   activate on dev, and checks the result.
4. **Upgrade on prod.** The same steps on prod, after the owner approves (prod
   receives nothing unapproved).

Between upgrade and activation the app is unavailable for seconds. A small CLI
wrapper (`cli app:upgrade feather_dash <version>`) prints the plan and runs the three
calls, so the window stays short and the steps cannot be done out of order.

**Install.** Once per instance, by a System Manager: install, set the settings, add
the front door. Dev first, then prod after approval.

### D7. Migration: four stages, each reversible until its clean-up

**Stage A: front door around today's page.** Platform only. No package yet.

- *Build:*
  - door config and host matching;
  - the door brand on `/api/brand` and the login page;
  - the door-host redirects;
  - Google `redirect_uri` per door;
  - the cross-address handoff;
  - door landing.
- *Interim target:* while no app exists, a door's target is the built-in report path.
  `"app": "feather_dash"` resolves to `/featherbase/sales-target` until the package
  is installed, and the existing report page renders inside a door-branded
  `ReportOnlyShell`. This is the only interim behaviour in the design, and stage B
  deletes it.
- *Live safety:* the trial address keeps working, and the Desk address is unchanged.
- *Rollback:* remove the `front_doors` value.

**Stage B: move the code into the package.**

- *Build:*
  - the platform pieces: E1 with today's derivation moved verbatim, E2, E3, E4, E5
    and E7;
  - D4's binding mechanism with the `Sales Target Viewer` default;
  - Feather Dash 1.0.0 with page parity.
- *Install and check on dev:*
  - Install the package on dev *beside* the core page.
  - Run a **parity check** on a restored dev snapshot. For every person with a scope
    today, the app's `me` and `report` answers must equal the core endpoints' answers
    (same scope, same rows, same totals), and the embed initial state must be
    identical.
  - Then the door target switches to the installed app, and the trial runs on it.
- *Promote:* after the owner's approval, the same steps run on prod.
- *Clean up:* a core release deletes the core page and route, `/api/sales_target/*`,
  `sales-target*.ts`, `datasets/sales-target-mtd.ts`, the old snapshot tables (by
  migration), `capabilities.report`, `landingFor` and `ReportOnlyShell`. The repo's
  no-compatibility-shim rule (CLAUDE.md) is satisfied: the parallel window is a
  rehearsed cut-over for the live trial, closed by a named step, not a permanent
  alias.
- *Rollback until clean-up:* point the door back at the core page.

**Stage C: adopt the roster redesign** (needs #449 and #392).

- *Build:*
  - the person-scope provider reads `position`, `section` and `section_subcategory`;
  - job roles are granted from current `position` rows;
  - app-role bindings move from `Sales Target Viewer` to the manager jobs;
  - `Sales Target Viewer` and `Sales Target Assignment` are removed (#449).
- *Check:* #449's own per-person parity check (scope before and after) is the gate.
- *App:* Feather Dash does not change, which proves the E1 boundary.
- *Rollback until clean-up:* the provider's previous body. The nine tables are
  deleted only after parity holds on prod.

**Stage D: section editing.**

- *Build:* Feather Dash 1.1.0, a code-only upgrade. It adds the my-sections page, the
  request and decide actions, and the reviewer page. The Table and grants were
  declared in 1.0.0.
- *Live safety:* the report is untouched.
- *Rollback:* do not activate. An upgraded but unactivated app is unavailable, so the
  real rollback is "do not upgrade prod until dev is proven".

### D8. Fit with the security rules (#437, #441, #443)

- **System-written audit.** Access Log rows (report views, refusals) and Version
  history are platform-written. The package gets `recordView`, not a write handle on
  audit Tables.
- **Security Tables.** `App Setting` and `App Role Binding` join `SECURITY_TABLES`.
  The package never writes a security Table on its own authority. The reviewer path
  writes master Tables only as a person whose own rights allow it.
- **Release preflight** gains three checks: a front door's validity, no app-role
  binding to `All`/`Guest`, and E7.
- **Scope.** Scope still fails closed. An ambiguous employee code still yields no
  scope, and a refusal reveals nothing.
- **Snapshot rows** are never a Table, never exported, and read only through a
  scope-checked read.

## Risks / Trade-offs

- **Two sign-ins for administrators.** This is accepted. A shared parent-domain cookie
  is the riskier alternative.
- **Google needs one redirect per door.** Forgetting it breaks Google sign-in on the
  door only, so the stage A checklist carries it. Password and StyleHR sign-in are
  unaffected.
- **The parallel window in stage B.** The core page and the app coexist for days. The
  clean-up release is a named task, so the window cannot become permanent.
- **Trusted code with outbound calls.** E5 runs the handler outside the transaction,
  so a slow MotherDuck no longer holds locks. A timeout on the embed call stays in
  the app, as `unreachable`.
- **The upgrade planner forbids new Tables.** Declaring stage D's Table in 1.0.0 is a
  small cost. The alternative, teaching the planner additive Tables, is broader
  platform work with its own review.
- **Shared design tokens.** Extracting them into a workspace package touches the
  design-guard tooling. If that slips, the client copies the tokens as Tasker does,
  and the guard pending list records it.

## Migration Plan

See D7. The order is A → B → C → D. Dev first at each stage. Prod gets each stage
only after the owner's approval. Each prod step runs on a restored prod snapshot
first, with prod's real environment variables, as `docs/DEPLOY.md` requires.

## Open Questions

**Q1. Where does the Feather Dash package's source live?**

- **A. In this repo, at `runtime-apps/feather-dash`.** It is built into the same image
  and covered by CI and the design guards. Every instance-specific value (Dive, door
  address, name) lives in instance config.
- **B. In the instance owner's private repo.** It is built separately and mounted
  into the image through `FEATHERBASE_APP_PATHS`.
- **Recommendation: A.** The report is in this repo today and contains no instance
  data. The image already bundles runtime apps, and B needs a second build-and-mount
  pipeline that does not exist yet. The report's SQL names warehouse schemas
  (`marts.sales…`), which ties it to one warehouse layout. If that is unwelcome in a
  public repo, choose B.

**Q2. Do managers' section edits go through a reviewer, or apply at once?**

- **A. A request, and a reviewer applies it** (D5).
- **B. Direct edits within scope,** with the history reviewed afterwards.
- **C. A mix.** Confirmations and staff placements apply at once; subcategory moves
  need review.
- **Recommendation: A.**
  - It keeps #437's "only a System Manager or the named writer role writes scope"
    rule intact.
  - A subcategory move changes another person's scope.
  - The warehouse epic already plans a Data Review step.
- B and C each need a narrow, platform-reviewed exception to #437. That exception is
  possible, but it is a security decision for the owner, not a technical default.

**Q3. Where do emailed links point?**

- **A. `SITE_URL`, then a handoff to the person's door after sign-in** (D3).
- **B. The door the invited person will use,** decided when the email is sent.
- **C. A single instance setting,** "address for emailed links", set to the dash
  address.
- **Recommendation: A.**
  - It works whichever link or bookmark a person uses.
  - It needs no guess about the person's door at invite time, when they may hold no
    role yet.
  - `SITE_URL` stays the one origin the preflight requires.
- C is simplest if every emailed person is staff, but administrators would then land
  on dash.

**Q4. How does the app say who may use it?**

- **A. Its own app roles, bound to jobs by instance data** (D4), with manifest
  defaults applied once.
- **B. The manifest names jobs directly** (`readRoles: ["Team Leader", …]`).
- **Recommendation: A.**
  - People still hold only jobs, which is #392's concern.
  - Widening or narrowing the audience is a System Manager's edit, not a package
    release. The planner's "upgrades never widen a grant" rule (#437) would make B
    need a reviewed reinstall for every audience change.
- B is fewer concepts and could be enough if the audience never changes.
