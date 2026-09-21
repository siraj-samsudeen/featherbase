# Trusted Runtime Packages

## Purpose

A trusted application such as Tasker can be built, delivered, installed,
disabled, restored, and used without rebuilding Featherbase core. Application
identity, storage, UI, rules, and lifecycle remain isolated even when two apps
use the same local names.

This is an **additive OpenSpec evaluation** of
`docs/specs/0011-runtime-packages.md`, which remains authoritative. It describes
the first build-and-learn slice, not a stable public or untrusted plugin API.

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

## Lifecycle table

| Installed | Enabled | Compatible code found | State | Data access |
|---|---|---|---|---|
| no | — | compatible package discovered | available to install | no owned data |
| no | — | absent or incompatible | unavailable | no owned data |
| yes | yes | yes | active | normal permissions and hooks |
| yes | no | yes/no | disabled | denied; data preserved |
| yes | yes | no | unavailable | denied; data preserved |

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
signed-in catalog SHALL show only active accessible apps. Disabled or missing app
navigation SHALL explain unavailability and preserved data without exposing
manager-only controls.

#### Scenario: tasker_opens_without_core_import
- **WHEN** built Tasker is staged after Featherbase core was built
- **THEN** `/tasker/` opens without a core rebuild or Tasker-specific core route.

#### Scenario: missing_asset_is_not_html
- **WHEN** a caller requests an undeclared Tasker JavaScript asset
- **THEN** the response is not found rather than either application’s index page.

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
- **THEN** each pointer names the new qualified Table and the same work remains usable.

## Deferred

Marketplace discovery, signing, untrusted-code isolation, distributed activation,
capability/dependency graphs, hot discovery, previewed upgrades, remove versus
delete-data, typed recents, and generalized application preferences remain outside
the first contract.
