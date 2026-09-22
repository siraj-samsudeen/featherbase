## MODIFIED Requirements

### Requirement: runtime_upgrade_recovery_boundary
Status: governed (#308)

Upgrade SHALL require the prior and target operator artifacts to be available and
retain prior identity for recovery. A deployment advertised as containing an
installed application's upgrade SHALL retain and discover the exact reviewed
predecessor alongside the target instead of replacing the predecessor directory
in place. Missing artifacts SHALL produce actionable unavailable status without
reset or automatic downgrade. After commit, recovery SHALL use the committed
target or a forward upgrade, not run old code against the target schema or
promise down migrations. Operator instructions SHALL distinguish package
delivery, explicit preview/upgrade/activation and backup restoration.

#### Scenario: committed_target_disappears
- **WHEN** committed target code is absent but the previous artifact is present
- **THEN** the application remains unavailable and directs the operator to restore the target artifact without modifying rows or ledger

#### Scenario: packaged_upgrade_retains_exact_predecessor
- **WHEN** an operator deploys an image advertised to upgrade an installed Tasker 0.0.1 application
- **THEN** discovery reports the reviewed 0.0.1 artifact and the advertised target as separate immutable versions
- **AND** restart keeps 0.0.1 available and active until an administrator previews, commits and activates the target
