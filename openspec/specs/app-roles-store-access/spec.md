# App Roles and Store Access

## Purpose

An app can declare its own roles — who may read its data, and who may act on
it — and split its data by store, such as a shop or a warehouse, so a person
only ever sees the stores they've been assigned. Every check happens fresh,
from what's currently assigned, never from what a browser claims or what an
admin's normal authority would otherwise allow.

## Requirements

### Requirement: Roles decide who can read and who can act

An app SHALL declare which of its roles let someone read its data and which
let someone act on it, and Featherbase SHALL check the person's currently
assigned roles fresh on every read and every action — never from something
the browser sends, and never from being an administrator. If a role or a
store assignment is removed, the very next request SHALL reflect that,
without needing the person to sign out first.

#### Scenario: A reader can't act

- **WHEN** someone holding only an app's read role calls one of its actions,
  even while claiming to have the action role
- **THEN** the action is refused before anything runs

#### Scenario: Removing access takes effect on the next request

- **WHEN** someone's role or store assignment is removed while they're still
  signed in
- **THEN** their very next read or action reflects the change, refusing if
  it should

### Requirement: A person only sees the stores they're assigned to

When an app splits its data by store, a person SHALL only read or act on
rows belonging to a store they're currently assigned to — asking for even
one store outside that assignment SHALL refuse the entire request, not just
trim it down to what's allowed. Nothing about being an administrator, and no
missing assignment, SHALL be read as access to every store.

#### Scenario: One store outside the assignment refuses the whole request

- **WHEN** someone assigned to stores A and C asks for A and B together
- **THEN** the whole request is refused, even though A alone would have
  succeeded

#### Scenario: No assignment is not read as full access

- **WHEN** someone has no store assigned at all, or claims administrator
  authority without an explicit assignment
- **THEN** access is refused rather than treated as covering every store

### Requirement: An app can add its own extra check on top

An app MAY layer its own extra authorization on top of the role and store
checks — for instance, checking against its own business data before
letting something through. That extra check SHALL run only after the role
and store checks already passed, SHALL only ever narrow access further, and
its own failures SHALL fail closed exactly like a missing role or store
assignment does.

#### Scenario: The extra check can only narrow, never widen, access

- **WHEN** an app's own extra check passes for one combination of store and
  item but the request asks for a different, unapproved combination
- **THEN** it's refused even though the store-level check alone would have
  allowed it

### Requirement: Reading never changes data

A read an app offers SHALL never be able to create, change, or delete
anything — not even by accident. Reads, and the app's own actions, SHALL go
through the same up-to-date checks described above.

#### Scenario: A read handler has nothing to write with

- **WHEN** an app's read handler runs
- **THEN** it has no way to create, update, or delete any row

### Requirement: A refusal doesn't say what it's hiding, but it's recorded

When access is refused, Featherbase SHALL NOT reveal whether the thing being
asked for exists or what about it was out of reach. Every refusal SHALL
still be recorded for an admin to review — who asked, for what, and why it
was refused — without recording the request's private contents.

#### Scenario: A refusal is silent to the caller but visible to an admin

- **WHEN** a request is refused
- **THEN** the response reveals nothing about what was being protected
- **AND** an admin can see afterward that it was refused, and roughly why

### Requirement: A person can check which stores they can currently see

An app MAY let a person ask which stores they're currently assigned to, for
their own account only — never anyone else's, never with a store or role
they choose themselves. That answer SHALL reflect the assignment at that
exact moment, SHALL NOT be reused as proof of access for a later request,
and asking for it SHALL NOT run any of the app's own business logic.

#### Scenario: Checking your own access is exact and can't be reused

- **WHEN** someone checks their own store access, and then loses one of
  those stores in the same sitting
- **THEN** the first check reflects what they had at the time
- **AND** the next check reflects the loss
- **AND** neither check can be used later to regain access that was removed

### Requirement: fresh_app_store_access

Every protected read and action SHALL resolve the authenticated user's enabled
state, app availability, declared operation roles and explicit store values from
trusted current server state. Package-declared role names SHALL determine which
roles permit reads and which permit actions. Browser roles, store grants, filters,
SQL, navigation and cached state SHALL NOT authorize. The new store policy SHALL
reuse existing role and Data Scope assignments, deny absent scope, and have no
administrator bypass. Legacy Table CRUD scope semantics SHALL remain unchanged.

The following ordered decision table SHALL apply to store policies; the first
matching refusal wins without disclosing inaccessible resource details:

| Condition | Outcome |
|---|---|
| No authenticated enabled user | Refuse |
| App unavailable, disabled, pending activation or obsolete client identity | Refuse |
| Policy, required callback or store dimension missing/invalid | Refuse |
| No current role declared for this operation class | Refuse |
| Required requested/authoritative store set absent, malformed or empty | Refuse |
| Any requested/authoritative store absent from current explicit access | Refuse whole request |
| Required product authorization refuses or cannot resolve | Refuse |
| All applicable gates succeed | Admit only the normalized operation scope |

#### Scenario: reader_cannot_invoke_mutation
- **WHEN** a user holding only the package's read role calls its action endpoint
  directly, including with browser claims of the action role
- **THEN** no business handler, mutation or upstream call runs
- **AND** its read endpoint succeeds only for explicitly allowed stores

#### Scenario: entire_requested_set_is_checked
- **WHEN** an action-authorized user has A and C and requests A, A+C, or A+B
- **THEN** A and A+C succeed, but A+B refuses as a whole before business execution

#### Scenario: missing_scope_and_admin_do_not_bypass
- **WHEN** a principal lacks explicit scope, a request-scoped operation omits
  stores, or a caller claims Administrator authority without the declared grants
- **THEN** access refuses rather than interpreting absence as all stores

#### Scenario: session_survives_assignment_removal
- **WHEN** a role or store is removed after a successful request without logout
- **THEN** the next read and action use the changed assignment and refuse as needed
- **AND** disabling the user or app likewise prevents the next request

### Requirement: authoritative_object_store_scope

Object-addressed stores-policy operations SHALL declare a trusted scope resolver
separate from the business handler. After fresh principal/app/role and claimed-scope checks,
the host SHALL permit only declared package-owned scope-fact reads to resolve the
complete authoritative store set and resource identity. These authorization
lookups are the explicit exception to refusal before database reads; protected
data reads, result/cache disclosure, mutations and upstream business calls SHALL
remain forbidden until all gates pass. Scope resolution SHALL have no mutation,
general query, result or response helpers.

The authoritative set SHALL be nonempty and entirely within current store access.
A supplied claimed set SHALL equal it exactly after set normalization. Omitted
claim is permitted only with a declared resolver returning a complete nonempty
scope; explicit empty/malformed claims refuse. Resolution and handler execution
SHALL preserve scope consistency through one transaction and held scope-row locks.
Handlers SHALL receive immutable normalized authorized operation stores, not the
principal's wider grants. Unauthorized and nonexistent object scope SHALL produce
the same non-disclosing refusal.

#### Scenario: understated_object_scope_refuses
- **WHEN** a user entitled to A claims A for an object whose persisted scope is A+B
- **THEN** scope lookup may run but no business result, mutation or replay occurs
- **AND** the response reveals neither B nor the object's existence

#### Scenario: exact_scope_and_resource_identity
- **WHEN** an A+B user claims B+A for an A+B object with the correct child identity
- **THEN** the handler receives normalized A+B and succeeds
- **AND** substituting a child belonging to a different parent refuses before work

#### Scenario: omitted_claim_requires_authoritative_scope
- **WHEN** a resolver-based request omits stores and resolves A+B for an A-only user
- **THEN** it refuses rather than deriving only A or widening access

#### Scenario: scope_change_cannot_race_mutation
- **WHEN** another transaction attempts to change the locked scope row between
  resolution and business mutation
- **THEN** it cannot invalidate that operation's scope proof before commit
- **AND** a request waiting on the scope lock rechecks current assignments afterward

### Requirement: declared_product_gate_composes

An immutable operation declaration SHALL explicitly select generic-only or named
product authorization. A named gate SHALL run fresh after generic store approval
and before every protected handler or replay-result disclosure. Missing gate code,
failed lookup, malformed verdict or refusal SHALL fail closed across restart and
upgrade. Product authorization SHALL only narrow host authority. It SHALL receive
only current authorized operation scope, payload and declared authorization-fact
reads, without mutation or protected-result helpers.

The host SHALL provide no read-result cache that bypasses this gate. Products
SHALL authorize before their own cache reads and apply their complete exact scope
before aggregation, options and drill queries. Retail/employee/section joins SHALL
remain product-owned. Store access SHALL NOT imply section access. Replayable
product operations SHALL bind their complete original protected footprint to
immutable authorization metadata and reauthorize that footprint on retry.
Product-authorized actions SHALL require a stores-policy resolver supplying that
footprint; unsupported declarations and missing/non-JSON footprints SHALL refuse.
After product-fact lock waits the host SHALL recheck current user, role, entry
permission and complete store access before result disclosure or business work.

#### Scenario: product_action_requires_footprint_producer
- **WHEN** an action declares product authorization without a stores resolver,
  or its resolver omits the original product footprint
- **THEN** declaration or admission refuses before handler or protected result read

#### Scenario: product_lock_wait_sees_revocation
- **WHEN** a first request or replay waits for product authorization facts and
  generic role/store access is removed before the wait ends
- **THEN** final admission refuses without handler or protected result read

#### Scenario: exact_pair_composition_is_not_cross_product
- **WHEN** a proving package authorizes (A,X) and (B,Y) but receives (A,Y)
- **THEN** generic store approval does not allow a protected query or cache result
- **AND** permitted exact pairs succeed before and after package restart

#### Scenario: section_removal_blocks_cached_disclosure
- **WHEN** product section access is removed while generic store access remains
- **THEN** the next read/cache-hit and replay authorization refuse without output

#### Scenario: missing_declared_product_callback
- **WHEN** a package declaring product authorization loses that callback
- **THEN** activation or request admission refuses rather than using generic-only

### Requirement: runtime_reads_have_no_mutations

Independently installed trusted packages SHALL contribute named reads without
core app-specific routing. Reads and declared actions SHALL use the same callable
host authorization boundary and ordinary session, lifecycle, identity and error
contracts. A read context SHALL contain no mutation helpers at runtime. Policy,
handler and callback names SHALL be validated before activation; lifecycle changes
SHALL drain admitted work and prevent subsequent disabled/unavailable execution.

#### Scenario: independent_read_install_restart_disable
- **WHEN** a separately built proving package is installed, read, reloaded and disabled
- **THEN** reads work only while active with current assignments and no core rebuild
- **AND** no duplicate handlers register across restart

#### Scenario: read_context_is_not_action_context
- **WHEN** a read handler or scope resolver inspects its host context
- **THEN** create/update/delete and action-only helpers are absent at runtime

### Requirement: app_refusals_are_auditable

Authorization refusals SHALL not disclose resource existence or inaccessible scope.
The host SHALL record an operator-visible decision with caller, app, operation
and a bounded reason code using existing audit facilities, without payload, SQL,
credentials or result data. Missing policies/callbacks SHALL also produce visible
configuration diagnostics. Refusal audit SHALL survive business rollback.

#### Scenario: refused_action_audit_survives
- **WHEN** a protected action is refused
- **THEN** no business handler/upstream effect or result disclosure occurs
- **AND** the refusal audit remains without sensitive request/result contents

### Requirement: self_store_access_discovery

A stores-policy read MAY explicitly enable self-only store discovery. Discovery
SHALL freshly verify enabled caller, active exact app identity, entry access,
declared read role and valid owned store dimension, then return only sorted exact
current store codes from that caller's Data Scope. No current grants SHALL return
an empty array after other gates pass. Missing role/user/app/policy SHALL refuse.
No caller-selected user, role, dimension or scope override SHALL be accepted.
Discovery SHALL be operation-specific and invalid on table policies, actions or
unsupported declaration versions. It SHALL invoke no package handler, resolver,
product authorizer, upstream, protected-result/cache path or mutation helper.
It SHALL disclose no labels, role names, product rows or broader assignments.
Responses SHALL not be cached or accepted as authority for another request;
subsequent protected reads/actions SHALL independently recheck current full scope.
Audit SHALL preserve the same redaction contract as protected operations.

#### Scenario: discovery_is_self_only_and_fresh
- **WHEN** an A-only caller discovers access, then loses A in the same session
- **THEN** the first response is exactly A without B metadata and the next is empty
- **AND** a later read cannot use that old discovery to regain A

#### Scenario: discovery_rechecks_role_and_lifecycle
- **WHEN** the discovery caller loses its role or the user/app is disabled
- **THEN** the next discovery refuses without invoking any package callback

#### Scenario: discovery_does_not_cross_operations
- **WHEN** discovery is attempted on another operation lacking opt-in, with
  overrides, or with a malformed/foreign dimension declaration
- **THEN** activation or admission refuses without assignment disclosure
