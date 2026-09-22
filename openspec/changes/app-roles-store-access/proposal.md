## Why

Issue #279, approved on 2026-09-22, requires current server-side app roles and
explicit store access on every protected read and action. Session authentication,
Table permissions and a previously authorized replay result do not establish
authority over a non-Table application resource.

## What Changes

- Reuse `has_role` and `data_scope` as assignments; add no parallel ACL store.
- Declare store policies and normalize complete requested store sets. Separate
  Viewer reads from Planner mutations and deny missing policy or scope.
- Add a generic runtime-package read contribution and shared callable admission
  boundary, with trusted normalized scope in read/action contexts.
- Add explicitly declared self-only current store-code discovery for initial
  pickers, without running package callbacks or granting authority to later calls.
- Permit declared, narrow authorization-fact reads before business handlers so
  object-addressed operations prove complete persisted scope, not client claims.
- Bind original scope to durable action results and authorize before disclosure,
  including after source deletion and same-session role/store removal.
- Compose a required product authorization step without retail joins in core.
- **BREAKING:** require explicit version-2 action policies. Preserve historical
  artifacts for upgrade planning; unbound version-1 actions become unavailable
  with an operator diagnostic. Upgrade Tasker to explicit Table policy.

## Capabilities

### New Capabilities

- `app-roles-store-access`: fresh store-scoped app authorization, scope resolution,
  read contribution, product composition, and non-disclosing refusals.

### Modified Capabilities

- `transactional-runtime-actions`: explicit policy version, trusted authorization
  context and immutable authorization metadata before replay result access.
- `trusted-runtime-packages`: policy contribution validation and explicit
  historical-package upgrade behavior.

## Impact

Server permissions, runtime-actions, runtime-packages, host API routing, shared
structural types, action-result migration, Tasker and independently built proving
packages. Existing Table CRUD authorization semantics remain unchanged; #246 is
not implemented. No Budgets implementation, DASH employee/section joins or query
publication, native MotherDuck credential revocation, marketplace or deployment.
