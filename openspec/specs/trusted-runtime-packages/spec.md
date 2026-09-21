# Trusted Runtime Packages

## Purpose

A trusted application such as Tasker can be built, delivered, installed,
disabled, restored, and used without rebuilding Featherbase core. Application
identity, storage, UI, rules, and lifecycle remain isolated even when two apps
use the same local names.

This OpenSpec capability is the behavior authority. The earlier
`docs/specs/0011-runtime-packages.md` is frozen, non-authoritative migration
evidence. This capability describes the first build-and-learn slice, not a
stable public or untrusted plugin API.

## Domain assumptions

### Assumption: packages_are_fully_trusted
- **Assumption:** an operator installs only reviewed package code from trusted
  provenance.
- **Established by:** the explicitly trusted first-slice boundary in issue #296.
- **When:** 2026-09-21.
- **Detected by:** package review and operational provenance. The current runtime
  deliberately provides no sandbox capable of detecting a trust violation.

### Assumption: activation_is_single_server
- **Assumption:** one server process coordinates package activation; distributed
  activation is not promised.
- **Established by:** the current process-local runtime registry and lifecycle lock.
- **When:** 2026-09-21.
- **Detected by:** deployment topology review before multi-instance operation.

### Assumption: browser_fragment_is_client_only
- **Assumption:** a browser does not include its URL fragment in an HTTP request.
- **Established by:** the URL and HTTP platform contract.
- **When:** 2026-09-21.
- **Detected by:** the runtime-app login browser journey observes server-carried
  path/query separately from the fragment inherited by canonical login.

## Lifecycle table

| Installed | Enabled | Compatible code found | Activation pending | State | Data access |
|---|---|---|---|---|---|
| no | — | compatible package discovered | — | available to install | no owned data |
| no | — | absent or incompatible | — | unavailable | no owned data |
| yes | yes | yes | no | active | normal permissions and hooks |
| yes | yes/no | yes | yes | awaiting activation | denied; data preserved |
| yes | no | yes/no | no | disabled | denied; data preserved |
| yes | yes | no | yes/no | unavailable | denied; data preserved |

## Requirements

### Requirement: versioned_trusted_artifact
Legacy ID: PKG-R1 · `shape: contract`
Status: governed (#296)
A package directory SHALL contain npm package metadata and a strict declarative
manifest with exact manifest/runtime API versions. Discovery SHALL use only
operator-configured local directories. Optional compiled hooks SHALL target only
owned Tables through the public structural context. Reserved roots, escaping
paths, incompatible APIs, undeclared hooks, and partial failed installs SHALL be
rejected. This is a trust boundary, not a sandbox: server code has full Node
process privileges and browser code has same-origin authenticated privileges.

#### Scenario: incompatible_package_rejected
- **WHEN** discovery encounters an incompatible API version or reserved app name
- **THEN** the package is unavailable and no Table, grant, hook, or catalog entry
  is partially activated.

### Requirement: logical_identity_maps_storage
Legacy ID: PKG-R2 · `shape: invariant`
Status: governed (#296)
Each app-owned Table SHALL have a qualified logical identity and persisted owner,
physical schema, and physical relation. Every DDL, CRUD, permission, reference,
and query path SHALL resolve that metadata rather than infer storage from spelling.
Generic metadata edits SHALL NOT alter identity, storage, binding, or hook dispatch.

#### Scenario: same_local_name_and_row_id
- **WHEN** `tasker.task` and `other.task` both store row `same`
- **THEN** each returns only its own asymmetric columns and values.

### Requirement: lifecycle_fails_closed
Legacy IDs: PKG-R3, PKG-J2 · `shape: state machine`
Status: governed (#296)
Install SHALL provision once and enable atomically. Disable SHALL preserve Tables,
rows, grants, and ownership while removing launchability, hooks, package-owned
permissions, and data access. Re-enable SHALL require compatible code and register
hooks once. Missing code SHALL fail closed. A lifecycle change SHALL wait for every
admitted operation, including its post-commit work. Equivalent grants contributed
by another active package SHALL remain effective.

#### Scenario: stale_write_after_disable
- **WHEN** an already-open browser submits after Tasker is disabled
- **THEN** the write is rejected rather than bypassing Tasker validation.

#### Scenario: restart_and_restore
- **WHEN** code is absent across one restart and restored on the next
- **THEN** access is denied while absent and preserved data returns with one set
  of hooks after restoration.

### Requirement: app_data_is_api_only
Legacy ID: PKG-R3 · `shape: security contract`
Status: governed (#296)
App-owned data SHALL be admitted through authenticated, availability-aware APIs.
Direct `app_client` SQL and raw Query Reports SHALL NOT read app-owned relations,
whether the app is enabled, disabled, or unavailable. Query Reports SHALL connect
as the restricted database role rather than a table owner that can reset its role.

#### Scenario: query_report_cannot_escape_role
- **WHEN** an administrator-authored Query Report attempts a nested role reset and
  reads an app-owned relation
- **THEN** it is refused without returning app data in every lifecycle state.

### Requirement: app_owns_client_root
Legacy IDs: PKG-R4, PKG-J1 · `shape: contract`
Status: governed (#296)
An app SHALL own its direct root, React tree, navigation, and CSS. Featherbase
core SHALL serve only the declared contained client build, SHALL reserve platform
and technical roots, and SHALL NOT fall back to an SPA for missing assets. The
signed-in catalog SHALL show only active accessible apps. Opening an app while
signed out SHALL return to that app after sign-in. An app with its own client
SHALL NOT also create a competing generated Home Page; its Tables remain
available to administrators. Disabled or missing app navigation SHALL explain
unavailability and preserved data without exposing manager-only controls.

#### Scenario: tasker_opens_without_core_import
- **WHEN** built Tasker is staged after Featherbase core was built
- **THEN** `/tasker/` opens without a core rebuild or Tasker-specific core route.

#### Scenario: missing_asset_is_not_html
- **WHEN** a caller requests an undeclared Tasker JavaScript asset
- **THEN** the response is not found rather than either application’s index page.

#### Scenario: app_login_returns_to_one_launch
- **WHEN** a signed-out member opens an accessible application
- **THEN** sign-in returns to its client root and normal navigation has no competing generated Table page.

### Requirement: prototype_transition_preserves_work
Legacy ID: PKG-H1 · `shape: hazard`
Status: governed (#296)
The local prototype transition SHALL transactionally preserve row IDs, projects,
references, comments, history, files, shares, focus preferences, and grants. A
destination collision SHALL abort rather than merge or discard data. References
to disabled app-owned Tables SHALL reject rather than resolve a same-local-name
Table or silently skip work.

#### Scenario: occupied_destination_aborts
- **WHEN** the target Tasker relation already contains unrelated storage
- **THEN** migration aborts and every prototype row remains unchanged.

#### Scenario: transition_keeps_discussion_and_focus
- **WHEN** prototype work with comments, history, files, shares, and focus migrates
- **THEN** each pointer names the new qualified Table and all work is preserved
- **AND** access resumes once the installation has a reviewed package identity and compatible code; unversioned legacy installations follow `unversioned_legacy_install_fails_closed`

### Requirement: runtime_upgrade_identity
Status: governed (#296)

Installed runtime applications SHALL persist exact package version and an ordered immutable migration checksum ledger. Artifacts SHALL declare complete cumulative migration history and final schema. Missing, malformed, duplicate-different, reordered, skipped, downgrade and incompatible artifacts SHALL be rejected before mutation. Discovery SHALL NOT upgrade an installed application. Same-version retries SHALL not reapply migrations.

#### Scenario: upgrade_history_is_a_prefix
- **WHEN** a target changes or omits any previously installed migration or skips a declared predecessor
- **THEN** preview and upgrade reject it without changing installed state

#### Scenario: restart_selects_installed_code
- **WHEN** old and new artifacts are configured on restart
- **THEN** only the exact installed version is eligible for activation
- **AND** missing installed code leaves data preserved and unavailable

#### Scenario: unversioned_legacy_install_fails_closed
- **WHEN** a legacy installation has no recorded package version or complete manifest
- **THEN** discovery leaves its rows and grants intact but does not infer an installed code version
- **AND** the operator must recover its reviewed version/declaration before using the upgrade API

### Requirement: runtime_upgrade_reviewed_plan
Status: governed (#296)

An administrator SHALL preview a stable plan before upgrade, including current/target version, migration IDs, owned Tables/columns/indexes, permissions, jobs, destructive/data effects and code-only status. Upgrade SHALL require the exact preview identity and revalidate it under the lifecycle lock. This slice SHALL accept only additive optional scalar columns and code-only changes, refusing destructive operations, SQL, changed existing definitions, permissions, jobs and undeclared dependencies.

#### Scenario: reviewed_artifact_changes
- **WHEN** artifact or installed identity differs from the reviewed plan
- **THEN** upgrade rejects and asks for a new preview

#### Scenario: destructive_upgrade_refused
- **WHEN** a package removes a column or requests a data rewrite
- **THEN** preview refuses it rather than claiming rollback support

### Requirement: runtime_upgrade_commit_and_activation
Status: governed (#296)

Upgrade SHALL serialize with admitted operations and enable/disable, validate code before mutation, and commit physical schema, metadata, version and ledger together. Failure SHALL preserve the previous active code, contributions, data and durable state. Successful commit SHALL suspend old code and client access until explicit administrator activation; restart SHALL preserve this pending state. Activation SHALL require the committed artifact, wire hooks once and preserve the enabled choice. Disabled upgrades SHALL stay disabled. HTTP operations using an obsolete application version SHALL be rejected rather than invoking new hooks for old clients.

#### Scenario: failed_migration_preserves_active_version
- **WHEN** a later migration fails after an earlier column addition
- **THEN** neither addition nor ledger update remains and old hooks continue

#### Scenario: upgrade_drains_admitted_work
- **WHEN** a write is admitted before upgrade and has pending post-commit work
- **THEN** upgrade waits for that work and queued obsolete writes reject after transition

#### Scenario: restart_at_upgrade_boundary
- **WHEN** the process restarts before commit, after commit or after activation
- **THEN** it respectively restores the prior version, leaves the target pending activation, or restores the activated target without duplicate hooks

### Requirement: runtime_upgrade_preserves_owned_work
Status: governed (#296)

Upgrade SHALL preserve existing app rows, identifiers, comments, preferences and grants. A fresh target install and upgrade SHALL yield equivalent metadata and physical column schema. Package operations SHALL target explicit owned relations and never another app with the same local Table name.

#### Scenario: tasker_description_is_generic_migration
- **WHEN** Tasker v1 with asymmetric project/task/comment/preferences/grant values upgrades to v2
- **THEN** every previous value remains and the new optional Project description can be read and written through normal APIs
- **AND** fresh v2 schema equals upgraded v2 schema without Tasker-specific core migration code

### Requirement: runtime_upgrade_recovery_boundary
Status: governed (#296)

Upgrade SHALL require the prior and target operator artifacts to be available and retain prior identity for recovery. Missing artifacts SHALL produce actionable unavailable status without reset or automatic downgrade. After commit, recovery SHALL use the committed target or a forward upgrade, not run old code against the target schema or promise down migrations. Operator instructions SHALL distinguish package delivery, explicit preview/upgrade/activation and backup restoration.

#### Scenario: committed_target_disappears
- **WHEN** committed target code is absent but the previous artifact is present
- **THEN** the application remains unavailable and directs the operator to restore the target artifact without modifying rows or ledger

### Requirement: platform_storage_is_explicit
Legacy ID: PKG-R5 · `shape: migration invariant`
Status: governed (#296)
Featherbase-owned relations and functions SHALL live in PostgreSQL schema
`featherbase`. A fresh install SHALL create them there. An upgrade SHALL move
existing objects without replacing their identities, rows, constraints, indexes,
grants, RLS policies, references or migration history. Core logical identities
SHALL remain compatible and unqualified; application logical and physical
identities SHALL remain scoped. Runtime and migration paths SHALL resolve physical
relations deterministically without pooled mutable `search_path` routing.
Security-definer functions SHALL restrict name resolution and explicitly address
their dependencies.

`public.site` SHALL remain an explicitly named pre-tenant host registry. It SHALL
NOT be treated as tenant data or moved into the core schema. Site data SHALL remain
isolated in its selected site schema.

#### Scenario: fresh_and_upgrade_converge_to_same_shape
- **WHEN** a fresh database and an asymmetric exact pre-convergence database run
  the production migration command
- **THEN** both expose the same Featherbase-owned object shape, preserve expected
  upgrade rows and privileges, retain scoped app storage, and leave only the site
  registry at `public.site`.

#### Scenario: failed_convergence_retries_atomically
- **WHEN** convergence is forced to fail before commit and then rerun
- **THEN** the failed attempt moves no partial object set and the retry produces
  exactly one complete migrated state without duplicated rows or grants.

### Requirement: featherbase_human_routes_are_canonical
Legacy ID: PKG-R6 · `shape: routing contract`
Status: governed (#296)
Featherbase-owned human routes SHALL live under `/featherbase/`. Historical human
deep links SHALL redirect to their corresponding canonical path while preserving
query and fragment. Technical and direct runtime-app roots SHALL retain their
owners. Signed-out runtime-app navigation SHALL pass through canonical Featherbase
sign-in and return to the exact safe local app path, query, and browser fragment.
Login return destinations SHALL reject external, ambiguous, technical, legacy, or
malformed paths rather than navigate to them.

#### Scenario: old_and_new_deep_links_converge
- **WHEN** a caller opens equivalent `/admin/...` and `/featherbase/admin/...`
  deep links
- **THEN** the old URL redirects and both arrive at the same canonical screen with
  search and fragment state intact.

#### Scenario: signed_out_tasker_returns_to_tasker
- **WHEN** a signed-out caller opens `/tasker/` and completes sign-in
- **THEN** the browser returns to `/tasker/`, not the Featherbase home page.

#### Scenario: exact_runtime_app_location_survives_sign_in
- **WHEN** a signed-out caller opens a nested direct runtime-app path with encoded
  query state and a fragment selecting app work, then completes sign-in
- **THEN** canonical Featherbase login returns the browser to that exact safe path,
  query, and fragment so the selected work is open.

#### Scenario: unsafe_login_return_is_refused
- **WHEN** a login return destination is external, ambiguous, technical, legacy,
  non-canonical, or malformed
- **THEN** Featherbase ignores it and uses the signed-in member's normal landing
  page without navigating to the supplied destination.

## Deferred

Marketplace discovery, signing, untrusted-code isolation, distributed activation,
capability/dependency graphs, hot discovery, remove versus
delete-data, typed recents, and generalized application preferences remain outside
the first contract.
