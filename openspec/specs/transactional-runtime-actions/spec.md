# transactional-runtime-actions Specification

## Purpose
Let trusted runtime applications contribute caller-authorized atomic commands
with durable retry results, while the host retains permissions and lifecycle control.

## Requirements

### Requirement: declared_app_actions_fail_closed

The host SHALL execute only version-2 declared named actions with an explicit
recognized policy for every operation through one authenticated app-identity/
action-name endpoint. Declaration and handler names SHALL match exactly. Missing,
disabled, incompatible, inaccessible or undeclared actions SHALL fail before
handler execution or replay-result disclosure. Manager diagnostics SHALL expose
declared names and policy-upgrade requirements. Identical local names in different
apps SHALL remain distinct. Historical version-1 artifacts SHALL remain readable
for exact-identity upgrade planning but SHALL NOT acquire a default policy.

#### Scenario: stale_or_unauthenticated_action_call
- **WHEN** a caller has no session or submits a stale action after disable
- **THEN** the host rejects without running the handler or replaying private results

#### Scenario: two_applications_declare_same_action_name
- **WHEN** two active applications declare `transform`
- **THEN** the app identity selects only that application's implementation

#### Scenario: absent_policy_requires_explicit_upgrade
- **WHEN** an exact installed historical action artifact has no policy declaration
- **THEN** actions fail with an operator-visible upgrade requirement and stored
  data/results remain intact for an explicit reviewed package upgrade

### Requirement: action_helpers_preserve_caller_authority

Handlers SHALL receive unknown payload, caller identity, immutable host-authorized
operation scope, host validation rejection and narrow document helpers, never a
raw SQL transaction or caller override. Helpers SHALL restrict access to declared
local tables, ordinary caller table, row, field and reference permissions, and
current app availability. Shared tables SHALL require package permission
declarations as well as caller permission. Bound sources and privileged platform
configuration SHALL be refused. Activity reads SHALL require document read access
and redact inaccessible version fields. Comment helpers SHALL be append-only;
discussion reads SHALL use the authorized document activity helper. Action
deletion SHALL be limited to owned rows. List helpers SHALL refuse cross-table
related filters. Every action SHALL use the declaration's action-role semantics;
labelling an action read-only SHALL NOT grant mutation helpers to read-only roles.

#### Scenario: malformed_action_payload_or_attempted_bypass
- **WHEN** a handler rejects malformed payload or requests undeclared/private storage
- **THEN** the command fails and no partial rows or history survive

### Requirement: action_writes_and_replay_are_atomic

An action SHALL execute within one host-owned transaction. A successful command
SHALL atomically persist its JSON result, immutable complete authorization scope
metadata and payload identity under caller, app, action and idempotency key.
Same-key identical-payload retries SHALL return that result without business
handler execution only after fresh current authorization of the original scope;
different-payload retries SHALL conflict without result disclosure. Store sets
SHALL be normalized before identity comparison while object IDs and all other
payload fields remain bound. Authorization metadata MAY be read before full scope
approval; protected result data SHALL NOT be read until approval. Fresh checks
SHALL follow idempotency/scope lock waits. Missing/incompatible required scope
metadata SHALL deny replay. Explicit table/generic policies MAY replay historical
metadata-null table results under their current permissions, but stores/product
policies SHALL NOT treat those results as authorized.

Failed handlers or stale source revisions SHALL roll back all writes and Versions
and SHALL NOT consume a key. Update and delete SHALL require source revision
checks. Replay SHALL authorize the original recorded scope without requiring a
deleted source row or rerunning its scope resolver. Required current product gates
SHALL run against the immutable original footprint before result disclosure.

#### Scenario: asymmetric_multi_row_command_rolls_back
- **WHEN** a handler creates one row, changes a different row and then throws
- **THEN** neither change, shared relation change nor partial Version persists

#### Scenario: action_response_lost_and_caller_retries
- **WHEN** a committed request is repeated, including across restart
- **THEN** current authorization is checked before the original result returns
- **AND** no second destination is created, even when the source was deleted

#### Scenario: narrowed_retry_cannot_disclose_old_scope
- **WHEN** an A+B result is committed and B access is removed
- **THEN** the unchanged request refuses and the same key rewritten to A cannot
  disclose the A+B result
- **AND** neither request reads the protected result or executes the handler

#### Scenario: equivalent_store_order_replays_once
- **WHEN** unchanged authorized stores A+B are retried as B+A with the same IDs/key
- **THEN** the original result returns without a second mutation

#### Scenario: queued_retry_sees_revocation
- **WHEN** a duplicate waits for its idempotency lock while rights are removed
- **THEN** post-wait authorization refuses without result disclosure

### Requirement: action_commit_boundary_and_lifecycle_serialize

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

Action helpers SHALL expose document-authorized counts of comments, recorded
update Versions, declared incoming References, core File attachments and core
Share links under the source row lock. Counts SHALL use numeric comments,
versions, references, files and shares fields; deletion refusals SHALL expose
the same names with string values. Action deletion SHALL require an exact loaded
revision and SHALL refuse nonzero counts without deleting the source or links.
Runtime-target Comment, Version, File, Share and declared Reference writes SHALL
serialize with that source lock and SHALL reject a missing target. Apps MAY return
explanatory refusal results without a platform-specific retained-work status policy.
Previously committed replay results SHALL remain unchanged by additive count fields.

#### Scenario: action_delete_races_comment_or_reference_creation
- **WHEN** guarded deletion races a writer linking to the same runtime row
- **THEN** either the link commits first and deletion refuses, or deletion commits
  first and the writer refuses; no orphan link survives

#### Scenario: app_returns_retained_work_refusal
- **WHEN** a readable source has two comments or one recorded update
- **THEN** the helper reports those counts and the app can return an explanatory
  result while source and discussion remain unchanged

#### Scenario: core_attachment_and_share_refusal_replays
- **WHEN** an action explains refusal for a source with two File attachments and
  one Share link, then its committed request is retried after restart
- **THEN** files=2 and shares=1 remain in the original result and no source or link
  is deleted; a thrown command leaves no partial write or consumed retry key
