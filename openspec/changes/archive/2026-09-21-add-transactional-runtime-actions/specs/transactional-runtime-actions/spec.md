## Purpose

Let trusted runtime applications contribute caller-authorized atomic commands
with durable retry results, while the host retains permissions and lifecycle control.

## ADDED Requirements

### Requirement: declared_app_actions_fail_closed
Status: governed (#296)

The host SHALL accept only version-1 declared named actions through one
authenticated app-identity/action-name endpoint. Declaration and handler names
SHALL match exactly. Missing, disabled, incompatible, inaccessible or undeclared
actions SHALL fail before handler execution. Manager diagnostics SHALL expose
declared names. Identical local names in different apps SHALL remain distinct.

#### Scenario: stale_or_unauthenticated_action_call
- **WHEN** a caller has no session or submits a stale action after disable
- **THEN** the host rejects without running the handler or replaying private results

#### Scenario: two_applications_declare_same_action_name
- **WHEN** two active applications declare `transform`
- **THEN** the app identity selects only that application's implementation

### Requirement: action_helpers_preserve_caller_authority
Status: governed (#296)

Handlers SHALL receive unknown payload, caller identity, host validation rejection
and narrow document helpers, never a raw SQL transaction or caller override.
Helpers SHALL restrict access to declared local tables, ordinary caller table,
row, field and reference permissions, and current app availability. Shared tables
SHALL require package permission declarations as well as caller permission.
Bound sources and privileged platform configuration SHALL be refused. Activity
reads SHALL require document read access and redact inaccessible version fields.
Comment helpers SHALL be append-only; discussion reads SHALL use the authorized
document activity helper. Action deletion SHALL be limited to owned rows.
List helpers SHALL refuse cross-table related filters.

#### Scenario: malformed_action_payload_or_attempted_bypass
- **WHEN** a handler rejects malformed payload or requests undeclared/private storage
- **THEN** the command fails and no partial rows or history survive

### Requirement: action_writes_and_replay_are_atomic
Status: governed (#296)

An action SHALL execute within one host-owned transaction. A successful command
SHALL atomically persist its JSON result and payload identity under caller, app,
action and idempotency key. Same-key identical-payload retries SHALL return that
result without execution; different-payload retries SHALL conflict. Failed
handlers or stale source revisions SHALL roll back all writes and Versions and
SHALL NOT consume a key. Update and delete SHALL require source revision checks.

#### Scenario: asymmetric_multi_row_command_rolls_back
- **WHEN** a handler creates one row, changes a different row and then throws
- **THEN** neither change, shared relation change nor partial Version persists

#### Scenario: action_response_lost_and_caller_retries
- **WHEN** a committed request is repeated, including across restart
- **THEN** the original result returns and no second destination is created

### Requirement: action_commit_boundary_and_lifecycle_serialize
Status: governed (#296)

Actions and their deferred post-commit work SHALL hold the existing admitted
operation lock against lifecycle transitions. Post-commit effects SHALL run only
after the outer commit, never on rollback or replay. An effect failure SHALL NOT
undo committed documents, change the durable successful result, or permit
duplicate action execution. Effects are best effort, not durable delivery.
Restart/re-enable SHALL NOT accumulate handlers. Helpers SHALL be invalid after
handler completion and SHALL NOT allow overlapping document operations.

#### Scenario: disable_waits_for_admitted_action
- **WHEN** disable races an admitted action or its post-commit tail
- **THEN** disable waits, then subsequent calls fail closed

#### Scenario: action_post_commit_effect_fails
- **WHEN** an effect throws after successful command commit
- **THEN** writes and replay result remain committed and retry does not repeat effects

### Requirement: guarded_action_deletion_preserves_retained_work
Status: governed (#296)

Action helpers SHALL expose document-authorized counts of comments, recorded
update Versions and declared incoming References under the source row lock.
Action deletion SHALL require an exact loaded revision and SHALL refuse nonzero
counts with structured counts, without deleting the source or its history.
Runtime-target Comment and declared Reference writes SHALL serialize with that
source lock and SHALL reject a missing target. Apps MAY return explanatory
refusal results without a platform-specific retained-work status policy.

#### Scenario: action_delete_races_comment_or_reference_creation
- **WHEN** guarded deletion races a writer linking to the same runtime row
- **THEN** either the link commits first and deletion refuses, or deletion commits
  first and the writer refuses; no orphan link survives

#### Scenario: app_returns_retained_work_refusal
- **WHEN** a readable source has two comments or one recorded update
- **THEN** the helper reports those counts and the app can return an explanatory
  result while source and discussion remain unchanged
