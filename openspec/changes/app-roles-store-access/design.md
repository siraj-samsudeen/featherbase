## Context

Base: origin/main `775958a`, merged #298. See proposal.md for motivation.
`permissions.ts` owns `has_role` and `data_scope`; ordinary Table scope is
deliberately permissive when a dimension has no rows. `runtime-actions.ts`
checks entry-table permission then selects payload AND result before invoking a
handler. `runtime-packages.ts` validates exact immutable package artifacts;
upgrades require both historical artifacts and cumulative migration history.
Existing canonical runtime-package/action specs already baseline these seams.
No legacy Table authorization behavior is being modified or recharacterized.

## Goals / Non-Goals

**Goals:** one host authorization boundary for trusted package reads/actions,
complete store sets, object-addressed scope proof, fresh replay authorization,
and explicit product-owned narrowing. The implementation is a new use of existing
assignment sources, not a new ACL system.

**Non-Goals:** Budgets implementation/month semantics/revisions/draft issuance;
DASH employee/merchandise joins/query publication; arbitrary Hono mount ownership;
native MotherDuck credential revocation; distributed activation; changing generic
Table CRUD; sandboxing malicious trusted Node modules.

## Decisions

### Package policy is explicit, roles are package vocabulary

Structural types belong in `packages/shared`, schema validation in the owning
server modules. These are proposed public names, not claims about existing code:

```ts
type AppAccessPolicy =
  | { kind: 'table' }
  | { kind: 'stores'; storeTable: string;
      readRoles: string[]; actionRoles: string[] }

type AppScopeSource =
  | { kind: 'request' }
  | { kind: 'resolver'; name: string;
      facts: { table: string; columns: string[] }[] }

type AppProductAuthorization =
  | { kind: 'generic' }
  | { kind: 'product'; name: string;
      facts: { table: string; columns: string[] }[] }

type AppOperationDeclaration = {
  policy: AppAccessPolicy;
  scope?: AppScopeSource;
  authorization: AppProductAuthorization;
}
```

Strict union schemas require `scope` for stores policies and forbid it for table
policies. Each role list is explicit; an empty list denies that operation class.
At least one list is nonempty. Core contains no universal Viewer/Planner role
names: a Budgets package can declare `readRoles: ['Budget Viewer', 'Budget
Planner']`, `actionRoles: ['Budget Planner']`. A read uses readRoles; an action
uses actionRoles, never a package's claimed `readOnly` flag. An operation's policy
is immutable package configuration, not a request parameter. Table policy keeps
entry-table read plus all current document-helper permissions; it is not store
authorization. Stores policy has no Administrator/System Manager bypass.

`storeTable` must resolve to a local Table dimension; its row identifier is the
explicit store code represented by `data_scope.for_value` with the exact logical
`allow_table`. Missing dimension, role or values denies. Grants continue through
existing privileged Role/User/Data Scope administration; installation never
auto-assigns app access. Existing Table semantics are unchanged.

### Named contributions, not arbitrary core routes

```json
{
  "actions": {
    "version": 2,
    "tables": ["budgets.draft"],
    "operations": {
      "issue": {
        "policy": {"kind":"stores", "storeTable":"budgets.store",
          "readRoles":["Budget Viewer","Budget Planner"],
          "actionRoles":["Budget Planner"]},
        "scope": {"kind":"resolver", "name":"draft_scope",
          "facts":[{"table":"budgets.draft","columns":["store_codes"]}]},
        "authorization": {"kind":"generic"}
      }
    }
  }
}
```

`reads: {version:1, tables:[...], operations:{...}}` uses the same operation
declaration. Server modules export exact named `actions`, `reads`,
`scopeResolvers`, and `authorizers`; declared/exported names must agree. Reject
unused, missing, duplicate or nonfunction callbacks, unknown fields/policies,
foreign/system/bound scope-fact tables and undeclared fact columns before
activation. Shared read helpers retain existing declared-table permissions.

HTTP actions retain `POST /api/app_actions/:app/:action` and
`{idempotencyKey,payload}`. Add `POST /api/app_reads/:app/:read` with `{payload}`,
JSON `{result}` responses and no host result cache. POST accommodates structured
read inputs without creating package-specific routes or allowing arbitrary SQL.
Both use ordinary authentication, error envelope and pinned app identity.
This is the generic named read contribution needed here, not all of #274.

For stores policies `payload` is an object. `payload.storeCodes`, when present,
must be an array of nonblank exact strings; normalize to a sorted unique set
without trimming/coercion. Request scope requires a nonempty set. Resolver scope
may omit the claim only because the trusted resolver must produce a nonempty
set. An explicitly empty or malformed claim always denies. Normalization occurs
before canonical payload fingerprinting, so A+B and B+A are equivalent; all other
payload fields, including resource IDs, remain part of identity. Browser roles,
filters, SQL and landing state never participate in policy resolution.

### Two-stage scope resolution, not a subset-only object claim

```ts
interface AppScopeFacts {
  get(table: string, rowId: string): Promise<Readonly<Record<string, unknown>>>
}
interface AppScopeResolutionContext {
  readonly user: string;
  readonly payload: unknown;
  readonly requestedStoreCodes: readonly string[] | undefined;
  readonly facts: AppScopeFacts;
  reject(): never;
}
interface ResolvedAppScope {
  readonly storeCodes: readonly string[];
  readonly productScope?: unknown; // JSON authorization facts, not result bytes
}
type AppScopeResolver =
  (context: AppScopeResolutionContext) => Promise<ResolvedAppScope>;

interface AppAuthorizationContext {
  readonly app: string;
  readonly user: string;
  readonly operation: string;
  readonly policy: 'table' | 'stores';
  readonly storeCodes: readonly string[]; // requested/authoritative set, NOT all grants
  readonly productScope?: unknown;
}
interface AppProductAuthorizationContext {
  readonly authorization: AppAuthorizationContext;
  readonly payload: unknown;
  readonly facts: AppScopeFacts;
  reject(): never;
}
type AppProductAuthorizer =
  (context: AppProductAuthorizationContext) => Promise<true>;
```

Use one callback-scoped `withAppAuthorization(...)` host entry point for both
reads and actions, holding `appOperation` and the appropriate host transaction
for resolution through handler completion. It receives a resolved immutable
declaration and host-authenticated principal, never a browser-supplied policy.
Future host endpoints compose this callable boundary, not cached context values.
Do not expose a context as a reusable bearer credential.

First check current user enabled, installed/active app, entry access, declared
operation role and any supplied claimed store set. Then run the declared resolver
with only the scope-fact reader. `facts.get` returns ONLY declared columns of an
owned local nonsystem Table, plus its row identifier; no list, arbitrary filters,
SQL, response, result cache, upstream client or mutation helpers. Scope facts are
privileged authorization metadata and need not satisfy normal business-row read
permission. The resolver may compose bounded keyed lookups, including checking
a line's parent ID; core has no Budgets table names or joins.

Read scope-fact rows under a row lock held through the business transaction.
Scope-defining fields must live on those locked rows, not derive from an unlocked
collection whose membership could change. Packages needing collection-derived
scope must materialize the complete scope on a lockable owned row or defer that
operation; this slice deliberately has no general SQL resolver. A missing row,
invalid scope, identity mismatch or inaccessible complete scope gives the same
non-disclosing refusal. Any supplied claim must equal the authoritative set,
not merely intersect it or be a subset. Recheck fresh assignments after resolver
lock waits before admitting business work.

`RuntimeReadContext` contains user, payload, authorization, reject and only
permission-preserving document get/list/activity helpers. It has no write,
create/delete/deletionState helpers at runtime. `RuntimeActionContext` gains
`authorization`; its mutation helpers otherwise preserve existing permissions.
Contexts and nested scope values are immutable snapshots and helpers expire after
callback completion. Host scope normalization never widens a caller's request.

### Product narrowing is declared and reruns before every disclosure

For a product authorization declaration the named authorizer is mandatory and
must return exactly true; throw/false/undefined/missing code all deny. Run it
after complete store authorization but before the business handler or saved
result SELECT. It receives freshly checked generic context and optional original
productScope, never mutation helpers or result bytes. Its declared facts reader
is separate from the resolver allowlist and follows the same locks/limits.
Generic operations explicitly declare `authorization:{kind:'generic'}`.

Product-authorized actions require a stores policy and a scope resolver returning
the original JSON productScope. Reject table/product and request/product action
declarations in this slice; otherwise no producer could supply the footprint.
A resolver may derive it from validated explicit payload with an empty facts
allowlist. Product reads can use request scope because the host never replays
their results. The authorizer validates the productScope shape it understands;
missing or incompatible footprints fail closed after upgrades as well.

A DASH proving fixture uses exact pairs (A,X), (B,Y), denies (A,Y), and reruns
its authorization after section removal while store access is unchanged. The
core does not interpret or compile productScope, employee mappings or queries.
The app applies exact pairs before aggregation/options/drill and guards its own
cache. Store authority alone does not authorize sections. A replayable product
operation must record its complete original protected footprint as JSON
productScope so the fresh authorizer can check that original footprint, not a
newly narrowed footprint. Missing required footprint denies. Actual DASH joins
and query/result-cache implementation remain a consumer responsibility.

### Replay reads metadata before results

Add nullable `authorization jsonb` to private `runtime_action_result` with a
versioned `RuntimeActionAuthorization` value:

```ts
interface RuntimeActionAuthorization {
  version: 1;
  policy: 'table' | 'stores';
  storeTable?: string;
  storeCodes: string[];
  productScope?: unknown;
}
```

Metadata and result commit atomically and are immutable. Caller/app/action/key
remain the primary key; normalized canonical payload binds resource IDs and
claimed store intent. Admission order is:

1. Validate authenticated caller, envelope, availability and declared policy.
2. Enter action transaction and acquire existing idempotency lock.
3. Fresh user/role/current claimed-scope checks after the lock wait.
4. SELECT only payload and authorization metadata, never result.
5. Existing key with different canonical payload: conflict, no result read.
6. Replay: use immutable original scope metadata, never rerun an object resolver
   against a possibly deleted source. Freshly authorize its entire set and the
   currently declared product authorizer against original productScope.
7. First run: scope resolver, exact claimed-set comparison, current whole-set
   check and product authorizer under held scope-row locks.
8. After product-fact lock waits, freshly recheck enabled user, entry access,
   operation role and the entire resolved/original store set. Keep all fact locks
   held. This final admission barrier also applies to reads; pre-wait grants are
   not sufficient. Lock/deadlock failures abort admission, never bypass it.
9. Only now SELECT protected replay result or invoke the business handler.

Missing/malformed/incompatible store replay metadata denies. A current stores
policy cannot replay a historical table-only result. Dimension mismatches deny;
current policy/role configuration is authoritative, never old grants. An old
metadata-null Tasker result may replay only under explicit current table policy
with generic authorization; this is a named migration case, not a missing-policy
bypass. Product-restricted actions cannot inherit unbound historical results.

### Refusals and audit

Return a uniform PermissionError for authorization failure without object
existence, store lists or product detail. Use existing Access Log with caller,
app/operation and a fixed decision/reason code; never payload, SQL, tokens or
result data. Configuration failures must be operator-visible at load and call.
Ensure denial audit survives rollback of business work (outside failed action
transaction); test it rather than catching and swallowing audit failures.

## Risks / Trade-offs

- Trusted code can import Node APIs → contract/helper guarantees are not a
  malicious-package sandbox. Review provenance and package scope discipline.
- Scope-row lock contention → keyed metadata reads only; no broad query API.
- Data Scope dimension is shared wherever the same logical dimension is used →
  use app-owned dimensions when access must differ per app; no duplicate ACL.
- Authorization is fresh at admission, not continuous cancellation → a committed
  removal affects the next request; recheck after host lock waits. Already-admitted
  operations and already-issued native bearer credentials are not revoked.
- Package author can understate actual result scope → request-only operations
  must restrict handler work to context.storeCodes; object operations declare a
  resolver. Proving fixtures exercise underdeclaration, not only subset logic.

## Migration Plan

Recognize exact v1 artifacts for predecessor discovery and upgrade planning, but
do not execute their undeclared actions. Diagnose policy upgrade required at
install/restart; other unaffected package contributions retain their contract.
No synthesized v1 table policy, same-version manifest edit or automatic upgrade.
Create Tasker 2.1.0 with version-2 operations using explicit table/generic policies,
unchanged schema/permissions/payload names and an empty-operation cumulative
migration from 2.0.0. Preserve original 0.0.1/2.0.0 artifacts in the proof journey.
Preview → Upgrade → Activate remains explicit; pending and obsolete pinned client
requests deny. No deployment is authorized. Failed upgrade preserves old data and
diagnosable action unavailability; after commit use target restoration/forward
upgrade, not destructive reset or downgrade. Ledger column is additive; no ACL
data migration or automatic assignment is needed.

## Design review record

2026-09-22: inspected #279/#246/#274/#296/#298 and canonical specs, then consulted
Oracle specifically on policy version compatibility and pre-replay product gates.
Its findings added explicit v2 policy, exact predecessor handling, post-lock fresh
checks, runtime read-only context and immutable complete replay footprint. The
later Budgets clarification led to the narrow two-stage resolver above rather
than claiming client-scope subset checks prove persisted object access.
`mattpocock-skills:grilling` was invoked but is unavailable; no claim it ran.
Owner accepted this planning direction via the coordinator on 2026-09-22.
Oracle reviewed the populated plan and found two concrete gaps: product actions
without a footprint producer and grant revocation during product-fact lock waits.
This revision rejects the unsupported combinations and adds the final admission
barrier; both have explicit scenarios and implementation tasks.
