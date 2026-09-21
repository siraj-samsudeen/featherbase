# Issue #296 — Tasker runtime-app architecture checkpoint (WIP)

- **Status:** learning-slice implementation plus provisional follow-on direction; see spec 0011 for executable obligations
- **Recorded:** 2026-09-21
- **Product:** Tasker
- **Initial users:** the Ramachandran data warehouse team

This note preserves the architecture discussion that followed the working task-management prototype. The prototype plan remains in [`issue_296_shared_task_management.md`](issue_296_shared_task_management.md), and the settled task behavior remains in [`0010-task-management.md`](../specs/0010-task-management.md). This note does not retroactively claim that the prototype has the package, loading, storage or shell architecture described below.

## Original prototype: observed, temporary seams (superseded by the slice below)

The original checkpoint proved the task journeys with a server-side `AppManifest`, server registration at boot, a compiled frontend `TaskManagementPage`, and hard-coded route/Home Page handling. Those were prototype seams: installing the manifest did not independently deliver the client page, and adding this kind of app required rebuilding Featherbase. The learning slice replaces those seams.

The task behavior already settled and exercised by the prototype remains in force. The architecture work below changes how an app is packaged, loaded, named and hosted; it does not reopen the task rules in spec 0010.

## Settled direction

### Product and experience

- The product is **Tasker**. “DWT Tasks” is not its name.
- Tasker is an app built on Featherbase, not a dedicated layout compiled into Featherbase.
- The approved Tasker experience is a full-stage app shell with:
  - a dedicated task sidebar;
  - a subtle app switcher;
  - starred projects as reorderable tabs;
  - a quick right-side inspector;
  - a full task page with the settled Together/Tabs preference;
  - reusable task rows;
  - all task behavior already settled in spec 0010.
- This experience is approved product direction, not a claim that every element is implemented in the current prototype.

### Independent app distribution

- Tasker and future Featherbase apps must be built and installed independently of Featherbase.
- Adding or upgrading an app must not require rebuilding Featherbase.
- External contributors must be able to build and distribute apps.
- An app package combines a declarative manifest with optional client code and optional server code.
- Featherbase loads those packages at runtime. A metadata-only UI contract is insufficient for apps such as Tasker, but declarative contributions remain part of the package contract.

### App-scoped data identity

- Tables are app-scoped. The user-facing type name is **Task**.
- Its permanent logical identity is `tasker.task`.
- Ordinary app-owned Postgres storage defaults to schema/table `"tasker"."task"`.
- Logical identity and physical storage mapping are explicit, even when the default makes them look alike. This permits an adopted or external table to retain a different physical location without changing its logical identity.
- Another app may independently own `helpdesk.task`; a bare global `Task` identity is therefore invalid.
- Cross-app references use qualified logical identities rather than ambiguous display names.

## Rejected options

- **A hard-coded dedicated Featherbase layout:** rejected because each app would require core frontend changes and a Featherbase rebuild.
- **Metadata-only application UI:** rejected because Tasker needs an intentional full-stage workflow and reusable interactive components that cannot be expressed adequately as table/view metadata alone.
- **Compiled-in app code:** rejected because it prevents independent installation, upgrades and external distribution.

## Provisional assumptions for the first slice

These are starting constraints for learning, not permanent platform promises:

- Load only trusted packages from local paths or npm-compatible package sources.
- Run trusted client/server contributions without an untrusted-code sandbox.
- Support only enough manifest and runtime contribution points to load Tasker end to end.
- Keep one explicit logical-to-physical table mapping, with app-owned Postgres as the default case.
- Prove one full-stage app shell without first generalising every navigation or layout extension point.
- Defer a public marketplace, package review/signing, untrusted isolation, and complete upgrade orchestration.

Observed friction in the experiment should revise the contribution contract. The first implementation is evidence gathering, not an attempt to freeze a comprehensive plugin API.

## Executable learning slice (21-Sep-2026)

Spec [0011](../specs/0011-runtime-packages.md) now fixes the acceptance surface
for this experiment. The sections below remain history of the exploration,
not permission to defer the approved build for more architecture discussion.

Stable implementation checkpoints, with a red/green test at each seam:

1. Persist separate label, owner and physical schema/relation metadata. Replace
   physical-name guessing on app-owned paths with one resolver. Prove two
   visible Tasks, different schemas/columns, same row ID, explicit references
   and asymmetric ordinary-user permissions through real HTTP.
2. Load versioned manifests/compiled owned-Table hooks from operator-configured
   package directories at boot. Add non-destructive enable/disable and separate
   signed-in catalog. Reject missing/incompatible code before activation.
   Serialize lifecycle transitions with admitted operations, including their
   post-commit work; reference holders and children also require activation.
3. Extract Tasker server/client into an independently buildable npm-compatible
   directory. Serve only its client build root under `/tasker/`, with a
   separate React root and full-stage shell. Remove core Tasker exceptions and
   proxy app roots in Vite. Add minimal Other package with a different Task rule.
4. Supply deterministic local prototype transition with collision refusal.
   Inspection found an installed `task-management` app and both Team Tables in
   the developer database on 21-Sep-2026; do not uninstall/drop these for tests.
   Exercise transition against disposable data before any developer DB write.
5. Build core first, then stage independently built packages without another
   core build. Prove install/open/use/disable/re-enable/restart, unavailable
   code, client-root containment and missing assets. Inspect desktop/mobile
   captures. Run affected server/web suites, broader storage regressions,
   typechecks and evidence checker. Record commands, actual results and gaps
   in PROGRESS. Commit locally; no push, PR, deployment or merge.

Test seams are the already agreed generic authenticated APIs, package loading
from real artifacts, manager lifecycle endpoints, signed-in catalog, static
HTTP and real browser navigation. Trusted hooks receive a narrow host-owned
validation function instead of importing AppError. Packages retain Node and
same-origin browser powers; this is explicitly not isolation. Discovery is
boot-only; no HTTP package installation and no dependency/capability graph.

## Owner decisions recorded during the implementation (21-Sep-2026)

- **Install:** Review → Install → Open; successful install enables automatically.
  Installed and enabled remain separate durable facts. Failure exposes no partial app.
- **Disable:** preserve package, owned data and grants; stop launchability, server
  contributions and stale-client writes. Re-enable does not reinstall. Runtime
  packages do not yet declare background jobs; future disabling must stop those too.
- **Remove / Delete application data:** separate future operations. Removal archives
  data and ownership/manifest metadata for compatible reinstall; deletion requires
  typed confirmation and an impact count. Legacy sample uninstall is not this design.
- **Upgrade:** future administrator-triggered Preview → Upgrade → Activate. Preview
  shows schema, permissions, jobs, destructive/data and code-only effects; code-only
  changes use the same path. Keep the old version active until validation, migrations
  and activation succeed, and retain its artifact for recovery. Not implemented here.
- **Identity/routes:** permanent platform identity/future schema `featherbase`; app
  identities/schemas `tasker`, `helpdesk`. Apps use direct roots (`/tasker/`). Core
  human routes will converge under `/featherbase/`; current `/admin`, login and other
  platform roots remain reserved in this slice. No mass core schema migration here.
- **UI ownership C:** apps own the full stage and placement of platform-supplied
  controls. Tasker keeps a subtle switch-back atop its sidebar. Detailed SDK account,
  theme, notification and switcher behavior is not settled; this slice exposes
  authenticated APIs/catalog and a host unavailable page, not a generalized SDK.
- **Preferences:** platform-owned, application-scoped, per-person, server-synced
  meaningful choices; apps declare keys/shapes. Tasker preserves its existing private
  focus key during the local transition. Key declarations/safe-update framework,
  project stars and Together/Tabs remain follow-on work; pixel widths may stay local.
- **Recents:** provisional structured private visits (person, app, kind, stable ID,
  timestamps/frequency); owning apps resolve current title/icon/destination and
  existence/access. A visit grants no access. No resolver framework is built here.

## Friction observed, not silently promoted to a permanent contract

The core and package builds are separate; `pnpm apps:prove` compiles server, shared
code and web before packing Tasker/Other, runs plain Node against frozen JavaScript,
then checks checksums after browser use and actual process restarts. Boot discovery
is explicit `FEATHERBASE_APP_PATHS`; tarballs are unpacked by the operator.

App-owned data currently requires the generic API. Direct `app_client` SQL and raw
Query Reports cannot read these relations even while enabled: those paths cannot
join process-local availability checking. The metadata override surface now
allowlists presentation/validation properties so it cannot redirect storage or
change hook dispatch. Lifecycle locks serialize this single-server experiment;
multi-server activation synchronization is not a claimed capability.

Tasker duplicates a small API adapter and CSS tokens, and links to the generic
Featherbase form for comments/attachments/history. Its hash-routed description
inspector proves app-owned navigation; starred project tabs, full task detail and
Together/Tabs are still approved product direction, not delivered UX. No Help Desk
implementation was added; Other is a deliberately asymmetric collision fixture.

## Approved next Tasker UX slice (21-Sep-2026)

The owner approved implementation and handoff without another design checkpoint:

1. rename projects inline with optimistic concurrency;
2. privately star and order projects as quick switching tabs;
3. add Together, grouping active work by responsible person plus Unassigned;
4. provide compact, right-inspector and focused-page task detail modes, with a
   private server-synced mode preference;
5. integrate comment entry, existing comments and Version history into Tasker.

The slice must update deterministic realistic scenarios, prove happy and edge
paths, render and inspect desktop/mobile states, and receive an independent
exploratory review before human handoff. Bulk Inbox triage remains deferred until
real use establishes its shape.

## Durable product context: Data Warehouse Operating System (DWOS)

Featherbase will host a real application portfolio, not hypothetical examples:
Tasker; Help Desk for internal DW issue reporting/triage; Report Server with
role-based access and the signed-in person's store/section mapped to permitted
subcategories passed as secure MotherDuck Dive filters; Learning Management for
team/client-project onboarding; and a business Data Catalog over MotherDuck/dbt
metadata, sample rows and freshness, able to flag data-quality issues into Help
Desk. Together this integrated product is the **Data Warehouse Operating System
(DWOS)**. These are future proof cases, not additions to this implementation.
Help Desk is the next UI-boundary experiment: issue → Tasker task links, distinct
actors, notifications, switching, recents and disabled-Tasker behavior must be tested.

DWOS is the operational home for warehouse/reporting **definitions, decisions,
exceptions, access rules and human workflows** currently stranded in email,
Excel and seed/config files. Additional real applications are **MDM**, initially
small/general lookup masters and source corrections/overrides when SAP is wrong,
later Employee Master replacing StyleHR and Item Master with eventual publication
back to SAP; and **Budget**, with monthly category-level Sales Targets (currently
seeds) and P&L Budget (currently Excel). These need suite → app → module support:
General Masters / Employee Masters / Item Masters and the budget modules are
provisional boundaries, potentially sharing planning/version/approval concepts.
Relevant warehouse-lifecycle applications belong here, not generic Airtable-style
breadth. None of this expands the #296 implementation.

Featherbase's longer-term scope is **ERP-scale applications**, comparable in breadth
to SAP/Oracle, serving multiple clients with smooth upgrades. The contribution
ecosystem combines WordPress-style distribution and VS Code-style declared UI,
action and backend contributions, with independently selectable parts: a
**distribution package is not an independently enableable capability**. Future
capabilities need their own dependencies, ownership ledger and disable/remove/data
purge semantics. First-party and external features must use the same governed
public contribution API. Upgrade guarantees depend on package-owned read-only
layers, client/site overlays, stable identities, previewed migrations and versioned
compatibility contracts; arbitrary private-internal patches are outside that
guarantee. Capability granularity and layer machinery remain deferred. This slice
activates whole trusted packages only and does not claim to prove those properties.

## Earlier pending decisions, retained for context

1. **Trust and isolation:** what trusted means, which client/server capabilities packages receive, and which isolation boundary follows later.
2. **Lifecycle:** install, enable, disable, upgrade, remove and purge semantics, especially the distinction between removing code and deleting app-owned data.
3. **UI ownership boundary:** which shell, navigation and shared interaction primitives Featherbase owns versus which full-stage surfaces and components the app owns.
4. **Routes and app switching:** route registration, URL ownership, app discovery, switching behavior and fallback when an app is disabled or absent.
5. **Personal settings:** ownership, namespacing, portability and cleanup for app-specific preferences such as starred-project order and Together/Tabs choice.
6. **Typed app-aware recents:** how recent items retain app and logical-type identity and reopen in the owning app rather than an accidental generic surface.
7. **Compatibility and dependencies:** Featherbase API compatibility, package dependencies, app-to-app dependencies and failure behavior for incompatible versions.

Do not settle later items speculatively when the preceding experiment can expose the real constraint.

## OpenSpec comparison checkpoint (21-Sep-2026)

The owner chose an additive trial: `docs/specs/0010-task-management.md` and
`0011-runtime-packages.md` remain authoritative, while
`openspec/specs/tasker/spec.md` and `trusted-runtime-packages/spec.md` re-express
the same contracts using OpenSpec requirements, scenarios, domain assumptions and
state tables. Legacy `TSK-*` and `PKG-*` IDs remain visible. `@spec` slugs connect
requirements to deciding code and asymmetric tests; the matrix now scans
`runtime-apps/` and server migrations because application code is no longer all
inside core.

This comparison already paid for itself. It caught an assumption/contract mix-up
around team grants and package powers, an incomplete package lifecycle row, an
omitted API-only security contract, and tests whose citations covered less than
their scenario claimed. The rapid-project test now enters three tasks, private
focus proves two users, reorder and reload, and urgency proves shared visibility
without changing either user’s focus. One gap remains deliberately visible rather
than laundered: `TSK-I2` says responsibility is one nullable user reference, but a
dedicated server test is still absent.

## Next build-and-learn experiment

Build the smallest real vertical slice that proves all three properties together:

1. **Independent runtime package:** Tasker is built separately, discovered from a trusted local or npm package source, and loaded without rebuilding Featherbase. Its package carries a declarative manifest plus the minimum client and server contributions it actually needs.
2. **App-scoped storage:** the package declares user-facing `Task`, logical `tasker.task`, and default Postgres mapping `"tasker"."task"`; runtime reads and writes resolve through that explicit identity/mapping rather than a global table name.
3. **Full-stage shell:** navigating to Tasker mounts an app-owned full-stage surface through a narrow Featherbase-owned host boundary, sufficient to exercise the dedicated task sidebar and one representative task journey.

The slice should retain the existing task semantics but need not yet solve marketplace distribution, untrusted code, all lifecycle transitions, general upgrade machinery, or every approved Tasker interaction. Record where the package has to reach through or duplicate Featherbase behavior; those points are evidence for the next contract revision.

## Recovery after context loss

1. Read this checkpoint, then the [prototype plan](issue_296_shared_task_management.md) and [task behavior spec](../specs/0010-task-management.md).
2. Treat the current `AppManifest`, compiled `TaskManagementPage`, route and Home Page exceptions as prototype evidence, not the target architecture.
3. Preserve the settled direction: independently installed runtime packages; manifest plus optional client/server code; app-scoped logical identities and explicit physical mappings; Tasker’s full-stage UX.
4. Resume at the first unresolved decision above only when the narrow runtime-package experiment forces it. Do not design the marketplace or full lifecycle first.
5. Keep assumptions provisional and update this note with observed friction before promoting any contract into a stable spec or ADR.
