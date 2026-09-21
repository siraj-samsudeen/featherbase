# Issue #296 — Tasker runtime-app architecture checkpoint (WIP)

- **Status:** design checkpoint, not an implementation plan or a description of current platform behavior
- **Recorded:** 2026-09-21
- **Product:** Tasker
- **Initial users:** the Ramachandran data warehouse team

This note preserves the architecture discussion that followed the working task-management prototype. The prototype plan remains in [`issue_296_shared_task_management.md`](issue_296_shared_task_management.md), and the settled task behavior remains in [`0010-task-management.md`](../specs/0010-task-management.md). This note does not retroactively claim that the prototype has the package, loading, storage or shell architecture described below.

## Current prototype: observed, temporary seams

The branch currently proves the task journeys with a server-side `AppManifest`, server registration at boot, a compiled frontend `TaskManagementPage`, and hard-coded route/Home Page handling. Those are acknowledged prototype seams. In particular, installing the manifest does not independently deliver the client page, and adding this kind of app still requires rebuilding Featherbase.

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

## Pending decisions, in order

1. **Trust and isolation:** what trusted means, which client/server capabilities packages receive, and which isolation boundary follows later.
2. **Lifecycle:** install, enable, disable, upgrade, remove and purge semantics, especially the distinction between removing code and deleting app-owned data.
3. **UI ownership boundary:** which shell, navigation and shared interaction primitives Featherbase owns versus which full-stage surfaces and components the app owns.
4. **Routes and app switching:** route registration, URL ownership, app discovery, switching behavior and fallback when an app is disabled or absent.
5. **Personal settings:** ownership, namespacing, portability and cleanup for app-specific preferences such as starred-project order and Together/Tabs choice.
6. **Typed app-aware recents:** how recent items retain app and logical-type identity and reopen in the owning app rather than an accidental generic surface.
7. **Compatibility and dependencies:** Featherbase API compatibility, package dependencies, app-to-app dependencies and failure behavior for incompatible versions.

Do not settle later items speculatively when the preceding experiment can expose the real constraint.

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
