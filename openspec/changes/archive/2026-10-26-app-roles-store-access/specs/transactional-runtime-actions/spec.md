## MODIFIED Requirements

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
