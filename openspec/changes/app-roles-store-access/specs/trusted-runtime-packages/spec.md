## ADDED Requirements

### Requirement: explicit_runtime_policy_upgrade
Status: governed (#279)

Package discovery SHALL validate read/action policy and required callback
declarations as immutable artifact contents. Missing policies SHALL NOT become
implicit unscoped grants. The host SHALL recognize exact historical version-1
artifacts for predecessor verification and reviewed upgrade planning without
executing undeclared actions. Install/restart SHALL expose their policy-upgrade
diagnostic while preserving data and unaffected contributions. Adding explicit
policies SHALL require a new package version and ordinary preview, upgrade and
activation; stored artifacts SHALL NOT be rewritten or automatically upgraded.
Pending/obsolete clients SHALL retain existing fail-closed identity behavior.

#### Scenario: tasker_policy_upgrade_preserves_work
- **WHEN** exact Tasker 2.0.0 is upgraded to a new artifact with explicit Table
  policies through a code-only cumulative migration and activated
- **THEN** existing work and retry identities remain intact and actions execute
  under current Table permissions, without imposing store roles on Tasker

#### Scenario: historical_artifact_is_not_relabelled
- **WHEN** a policy is inserted into an installed artifact without a new version
- **THEN** identity verification rejects it rather than trusting edited code

#### Scenario: policy_restart_is_fail_closed
- **WHEN** a required scope resolver/product authorizer is absent across restart
- **THEN** the protected contribution remains unavailable with a diagnostic
- **AND** restoring the exact artifact restores one registration, not duplicate gates
