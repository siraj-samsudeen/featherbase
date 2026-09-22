## ADDED Requirements

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

## MODIFIED Requirements

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
