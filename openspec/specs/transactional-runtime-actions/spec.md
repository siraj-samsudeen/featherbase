# Transactional Runtime Actions

## Purpose

An installed app can offer its own named actions — one command that does
several things at once, like moving a task and telling someone about it.
Featherbase guarantees that action either fully happens or doesn't happen at
all, that repeating the same request never runs it twice, and that the app
still answers only to what the calling person is actually allowed to do.

## Requirements

### Requirement: declared_app_actions_fail_closed

The host SHALL execute only version-2 declared named actions with an explicit
recognized policy for every operation through one authenticated app-identity/
action-name endpoint.

#### Normative details for the whole requirement

Declaration and handler names SHALL match exactly. Missing,
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
raw SQL transaction or caller override.

#### Normative details for the whole requirement

Helpers SHALL restrict access to declared
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

#### Normative details for the whole requirement

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

### Requirement: Work that happens after an action commits doesn't repeat

An action may schedule follow-up work — such as a notification — to happen
right after its changes are saved. That follow-up SHALL run only once the
action's own changes are safely saved, never if the action failed, and a
failure in the follow-up itself SHALL NOT undo what was already saved or let
the action run again on retry. Disabling an app SHALL wait for any action
and its follow-up work already under way to finish first.

#### Scenario: A failed follow-up doesn't undo the action or repeat it

- **WHEN** an action's own changes are saved but its follow-up work then
  fails
- **THEN** the saved changes and the result already returned stay exactly
  as they were
- **AND** retrying does not run the follow-up work again

#### Scenario: Disabling waits for work already under way

- **WHEN** an app is disabled while one of its actions, or that action's
  follow-up work, is still running
- **THEN** disabling waits for it to finish
- **AND** any further call after that is refused

### Requirement: Deleting through an action respects the same delete guard

An action that deletes a row SHALL be refused under the same rule that
blocks deleting an installed app's row any other way — a comment, a
recorded edit, an attached file or an active share still on it, or an
out-of-date view of it — and SHALL tell the app what's holding the row back
so it can explain that to the person who asked. That refusal SHALL survive
being replayed later exactly as it was first given.

#### Scenario: An action explains why deletion was refused

- **WHEN** an action tries to delete a row that still has a comment and a
  file attached
- **THEN** the action is told what's still attached
- **AND** neither the row nor what's attached to it is deleted

#### Scenario: A replayed refusal stays the same

- **WHEN** that same refused request is submitted again later
- **THEN** it reports the same reason as before
- **AND** still deletes nothing

### Requirement: An action can ask who is enabled

An app's action or read SHALL be able to ask which of some people are enabled, as far as the calling person may see them. A built-in account, a person merged into another, and a service account are never enabled people.

#### Scenario: A person who has left is not enabled

- **WHEN** an action asks about a person who has been disabled and one who has not
- **THEN** only the person who has not been disabled is answered

### Requirement: A System Manager's action can hand over one of the app's own rows

An action SHALL be able to make an enabled person the creator of one row of a Table the app owns, so that a grant on rows a person created follows the row. The host SHALL refuse this when the calling person does not hold the System Manager role, and for a Table the app does not own.

#### Scenario: A row handed over follows its new creator

- **WHEN** a System Manager's action hands a row of the app's own Table to a person
- **THEN** that person reaches it through a grant on rows they created, and its earlier creator no longer does

#### Scenario: Anyone else is refused

- **WHEN** the action runs for someone who does not hold the System Manager role
- **THEN** the row stays with its creator

### Requirement: An app reads and proposes only on Tables it declares and an administrator lists

An app MAY declare base Tables of the instance, with the columns it reads and the columns it proposes on. It SHALL read and propose on one only when the Table is both declared and listed by an administrator in the app's linked Tables setting, and only the declared columns. These reads SHALL run as the app, so the caller needs no permission on the Table. A read SHALL NOT be able to propose or decide.

#### Scenario: Not listed

- **WHEN** an app reads a declared Table an administrator hasn't listed
- **THEN** the read is refused

#### Scenario: A column it didn't declare

- **WHEN** an app asks for a column it didn't declare, or proposes on one
- **THEN** it is refused
