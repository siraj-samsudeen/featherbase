## Agent handoff — updated 4 November 2026

**Delivery priority (owner, 4 November):** commit and push the coherent current
implementation to existing draft PR #683 for the owner's local agent to finish
and integrate. Stop feature expansion here. This is an incomplete takeover,
not merge/deployment approval. Start from the PR head, reconcile current
`origin/main`, and use the remaining checkboxes in `tasks.md`; do not restart
from the historical design-only task 1.4 instructions.

**Integration warning:** the handoff branch's common ancestor with the fetched
`origin/main` is `47541845`. At handoff, `origin/main` is `06ed1f83` and has 607
commits not included here. Its migrations now include `0006_readable_labels.sql`
and `0138_mandatory_access.sql`; reconcile these with this branch's
`0006_operation_permissions.ts` and authority model before applying migrations
to any existing instance. The passing checks below are branch-local, not proof
of compatibility with that newer main.

The owner requests a data-led handoff with **no new UI work**. The four follow-up
policies and initial sample field set are now agreed: shared contacts through one
authorised membership, per-row bulk outcomes, approval independent of editing,
and operational contacts separate from account access. Continue with server/API
verification. Remaining gates concern physical mapping, contracts and migrations;
do not reopen these agreed choices merely because the simulation was discarded.

**Done:** proposed permission/approval behaviour in the delta specs, the logical
model and bootstrap-to-approval examples below, and the structured examples in
`sample-data.json`. The disposable browser simulation was explored, then discarded
at the owner's request. Do not restore it or use its checks as proof of server
security. The retained design and sample cases are the takeover references.

**Locally implemented:** operation/Column permissions, correlated scoped grants,
independent bounded grant/revoke, job-derived authority, held corrections and
independent review through the normal save path. Dash declares its own
administration contract and operational Employee Table. Its Store, Department
and Section Manager configuration is exercised against actual organizational
mapping Rows, not only Person/contact examples. Generic metadata/save paths
enforce these contracts; platform code contains no Dash-specific role checks.

**Verification evidence:** Dash's real-Postgres platform suite passes 46 tests
(one existing skip). Its ordinary-HTTP walkthrough passes scoped mapping CRUD,
cross-section refusal, bounded delegation, forbidden-Column refusal, held
correction, independent approval and revocation. The committed-transaction
proof covers revocation while a write waits and competing reviews applying once.
Migration rehearsal on a restored disposable legacy database preserves creator
and restricted-Column contributions and rolls back the rehearsal. These checks
do not authorise a live migration or deployment.

**Still open:** the Platform Admin rename, installed legacy artifact/manifest
upgrade mapping, review consent, and delivery/archive. Current code still calls
the platform role System Manager; its app-data bypass has been removed. Multiple
Tables are configured as multiple grants on one role: there is no first-class
Table-group object. The PR remains draft/unmerged for local-agent integration.
Do not mark the entire change complete from the successful demo alone.

The isolated full server run passes 3,304 tests (one expected failure, 99 skips)
on a fresh disposable database. Server typecheck passes. The strengthened
administration/delegation scenarios pass all 23 focused tests; the actual Dash
administration scenarios pass all six, including successor and transfer at the
business-date boundary. The earlier overlapping run failed because temporary
Dash files disappeared and old activity history collided with a synthetic time
window. No expectation was weakened. Run the full server suite separately from
Dash's copy/remove test script.

**Existing-instance policy gate:** `runtime-packages.ts:upgradePlan` still
refuses new or widened grants on existing Tables, including reviewed upgrades.
The new Dash manager grants therefore cannot be delivered by that upgrade path.
Do not alter recorded artifact identities or silently remove this restriction.
The proposed resolution needs owner approval: permit an explicitly reviewed
security upgrade, while keeping unapproved grant expansion refused. Approval
must name the reviewed grant diff, including affected Tables, roles, operations
and Columns; ordinary app-update consent must never imply permission expansion.
The owner has not approved this policy. This is a policy decision, not
authorisation to migrate or deploy a live instance.

**Continue here:** finish the remaining tasks in `tasks.md`, preserving the
approved production contracts below. The original source audit at `40151182`
is historical; the current-main reconciliation below supersedes it. Keep the
discarded simulation out of implementation and verification.

### Sample data and verification without the UI

`sample-data.json` is a logical design companion, not an import format or runtime
test fixture. `rows` supplies the initial named records; `examples` supplies RA6,
CP1, transfer JA6, successor JA7, forbidden acting JA8 and a phone-only role.
Foreign keys contain IDs, while people should see ID — Name. The readable
bootstrap sequence below explains their purpose and ordering.

`verification_cases` supplies independent actions and expected outcomes. Start
with V01–V09: no delegation, bounded grant, held edit, approval, self-approval
refusal, column refusal, department/store boundaries and self-service. Then add
revocation, transfer, continuity, conflict, escalation and complete-grant cases.
V22–V24 now record agreed policies: shared contacts through any authorised
membership, per-row bulk outcomes, and approval independent of direct-edit rights. This list is a starting
acceptance dataset, not exhaustive concurrency or legacy-permission coverage.

Translate these values into inline setup inside the repository's real Postgres
rollback-sandbox tests, with no fixture loader or persistent test database seed.
Exercise public server operations as the named actors and assert both responses
and stored rows/proposals/history. Verify list/report reads as well as writes;
checking a pure permission helper or trusting the browser model is insufficient.
Keep each case isolated. Trusted bootstrap creates initial authority; subsequent
grants and edits must pass the normal checked operations. The runnable Dash
walkthrough and its required environment are documented in
`client-apps/jeyarama/dash/README.md`, under "Checking scoped administration
through the API". Its command is:

```sh
pnpm --filter server exec tsx ../../client-apps/jeyarama/dash/scripts/check-administration.mts
```

Run the sandbox scenarios with `pnpm --filter server test test/domain-` and the
Dash integration with `npm run test:platform` from the Dash directory, each with
its own disposable test `DATABASE_URL`. The separate multi-connection proof
requires `DOMAIN_ADMINISTRATION_COMMIT_PROOF=1` and the database named
`featherbase_issue462_administration_commit_test` on the local Postgres server;
its configuration refuses another host/database before migration setup.

### Scenario coverage audit — 4 November 2026

These are public-operation assertions with inline setup, not a JSON fixture
loader. The named design records are represented by equivalent synthetic values.
Server filenames below are under `apps/server/test`; Dash's file is
`client-apps/jeyarama/dash/platform-test/administration.test.ts`.

| Cases | Executed coverage |
| --- | --- |
| V01–V09, V18, V28 | Dash delegation/correction scenario: before-grant refusal, held correction, independent review, forbidden Columns, department refusal, self service, no Employee create/delete, account snapshots unchanged. Other-store refusal is also asserted by the correlated-scope and actual mapping scenarios. |
| V10 | `domain-delegation.test.ts` refuses a grant with no Scope; `domain-administration.test.ts` refuses reads/writes after a named Scope loses all tuples. |
| V11, V17, V20–V21, V23–V24 | `domain-approvals.test.ts`: revoked/disabled maker, conflict revision, rejection, mandatory/alternative rule composition, mixed bulk/import outcomes and approver without direct-edit power. |
| V12, V14 | Dash transfer/successor variants: old membership ends and replacement begins today; transferred contact loses delegated visibility and cannot be approved; departing officeholder cannot approve, successor can approve/revoke, original grantor/authority/Scope stay unchanged. |
| V13, V22, V26 | `domain-administration.test.ts`: named department access survives removal of reporting link, shared contacts use one matching membership, and (A, Homeware) OR (B, Clothing) never permits the cross-product. Reporting subtree tests cover cycles and start/end boundaries. |
| V15–V16, V29–V30 | `domain-delegation.test.ts`: acting/future escalation, further-delegation limits, shared-role/binding edits, descendant revocation, separate grant/revoke boundaries, atomic refusal of mixed replacement, and refusal to extend an appointment using revoke authority. |
| V19, V25 | Independent Column selections and creator-only contributions in `domain-administration.test.ts`: readable details need not be writable; a phone update cannot borrow another Column's unrestricted scope. |
| V27 | Domain tests refuse forged Role Assignments and platform-role holdings; `system-written.test.ts` preserves audit immutability. |
| Beyond samples | `domain-administration-commit.test.ts` proves competing revocation and review with committed transactions; approval tests cover import revert, PATCH, create/delete/amend and hook substitution; `migrate.test.ts` checks legacy grants through HTTP. |

### Current-main reconciliation — 3 November 2026 (task 1.4)

Rechecked against fetched `origin/main` at `47541845`, not a manager's local
branch. The existing PR branch is being merged with that revision without
rewriting its published history. The only merge conflict is OpenSpec context:
retain the capability-folder convention and current main's change-mode guidance.
The change itself retains its existing `spec-driven` schema and 19-task list.

| Dependency | Current evidence and implementation consequence |
|---|---|
| #246 (open) | `document.ts:assertUserPermissions` still returns when Data Scope is empty; `permissions.ts:checkUserPermissions` skips absent dimensions. Neither implements a complete administrative grant. New scoped assignments must fail closed without changing the meaning of an unrelated legacy unrestricted grant. |
| #392 (closed into #449), #449 (open) | Dash already owns `store`, `department`, `section` and dated `job_assignment` in `client-apps/jeyarama/dash/featherbase.json`, with relationship validators and `coverage.ts`/`provider.ts`. Reuse these records. Its report provider returns store/subcategory coverage; it does not return administrative membership tuples or job-derived grants. Do not equate report coverage with edit authority. |
| #617 (open) | `runtime-packages.ts` validates versioned reads/actions and wires restricted fact readers from `app-access.ts`. `getRoles` resolves current App Role Binding rows, but only as unscoped role names. Neither is the proposed per-assignment grant model. Extend platform-owned contracts; do not put permission decisions in Dash callbacks. The separate Apps UI stays outside this task. |
| #617 upgrade comments | Current upgrade planning supports adding Tables and schema migrations (#651), superseding the old no-new-Table assumption. It still refuses added/widened grants on existing Tables. Do not silently relax that restriction while adding domain administration. |
| #627 (open) | `workflow.ts` has state transitions and `waits_for_approval` notifications, not held corrections. Its transition writes the state directly, and notification recipients currently come from unscoped Has Role rows. Reuse the notification path but add scoped eligibility; a workflow transition alone cannot apply a domain proposal. |

Reusable implementation and boundaries:

- `saveDoc` already validates links, runs save hooks, checks managed settings and
  records Version history. Authorise the final row after hooks, not just the
  submitted payload. Cover trusted saves and direct workflow/assignment writes
  before removing any app `decides_scope` guard.
- `actionTransaction` and `afterCommitOf` already support nested savepoints and
  discard effects belonging to failed rows. Reuse this for V23's independent
  per-row outcomes; pending proposals must not emit a live-row update.
- `app-access.ts` supplies declared, read-only fact access with transaction-held
  locks and final revalidation. Membership needs sets of related rows, including
  protection against concurrent insertion, not only its current single-row
  `facts.get`. Follow the shared pre-row lock ordering in `row-lock-order.ts`.
- Person IDs are opaque `psn_…` references. Current account state lives in
  `person`, `sign_in_identity` and password/reset records; external employee
  identifiers live in `person_identifier`. Dash has no Employee contact Table.
  Add an app-owned metadata Table linked to Person for operational contacts;
  never copy a contact correction into account or identifier storage. The
  sample's JOB/C/PM IDs remain illustrative, not physical database keys.
- Permission flags/tiers, Has Role, row shares and Data Scope remain active
  contracts. Migration must preserve each original grant's creator restriction
  and column reach, as well as submit/cancel/amend and app availability. Do not
  merge differently scoped legacy grants into a broader permission. The main
  spec still gives System Manager broad data access; renaming that role alone
  must not silently decide a different business-data policy.
- Main now starts at `0001_baseline.sql` and has migrations through `0005`.
  Old references to migrations 0134/0135 are historical. Claim a new number
  under #566 before adding one; do not edit the generated baseline. Rehearsal
  targets are disposable local databases only, not live installations.

Owner decision (3 November 2026): removing administrative powers requires scoped
revoke authority, configured separately from grant authority. A Staffing Admin
cannot end or narrow a capability-bearing assignment solely through staffing
permission. Check the removed capabilities, recipient and affected scope against
the actor's revoke boundary. A replacement that both removes and adds powers
needs both checks. Expiry of an already-authorised period is not a new mutation;
changing that period is. The production contracts below resolve tasks 2.2–2.4;
task 2.5's naming and installed-artifact migration work remains open.

Owner decision (3 November 2026): use the recommended remaining choices and
complete the implementation before the walkthrough. Platform Admin requires
explicit domain grants for app-owned business data; platform configuration and
instance-table administration remain separate. A normal HTTP request, including
one by Administrator, is not trusted bootstrap. Only the server's explicit
provisioning/system-actor context may initialise app data without a domain grant.
Business approvals still apply to a platform administrator's domain operations.

### Production contracts — implementation baseline, 4 November 2026

These technical choices implement the owner's approved policies. The logical
records below remain useful examples; their illustrative IDs are not wire IDs.
No additional business decision or new UI is required for these contracts.

**Permissions and migration.** Replace the operation flags with one operation
per Permission Row and explicit Permission Column children. A permission names
its target Table, role, operation and contribution scope (`all` or `creator`).
Operations are create/read/update/delete/submit/cancel/amend/approve. Approve has
its own Column selection and never implies update. Column references must belong
to the permission's target Table; an empty selection never means all Columns.
Generated Row IDs, revision fields and system-managed Columns stay outside the
ordinary editable selection. Read visibility also governs searching, sorting,
grouping, exporting, printing, activity and attached records.

Do not enforce the provisional unique role/Table/operation key: two contributions
may have different creator restrictions or app provenance. Preserve those
contributions separately rather than merging their powers or reach. Migration
0006 is reserved on #566. Expand existing enabled operation flags and Tier reach
into explicit selections, retaining creator restrictions and owner_app. Existing
create reach includes the previously effective create/write Columns; newly
configured create and update selections are independent. Preserve child-column
inheritance as explicit target-column contributions, not a runtime Tier fallback.
Remove the old permission flags/Tier evaluator after the cutover; no dual writes.
Column sensitivity still controls anonymous outbound presentation separately
from a principal's explicit permission. Existing row Shares remain explicit
single-row contributions; Data Scope remains an additional narrowing constraint.
The migration must not interpret an absent legacy Data Scope as a new deny rule.

**Assignment and complete-grant evaluation.** A Role Assignment names exactly
one Person or Service Account, a reusable role, an explicit Scope, optional
effective dates, and provenance. Scope modes are all, creator, self, named,
direct_reports and subtree. Missing Scope, unavailable app, invalid resolver
output and missing required relationships deny that contribution. Conditions
within each tuple are AND; tuples are OR. One whole matching membership is
sufficient for shared operational contacts. Every changed Column must have a
complete grant for both stored and proposed values. Never union independent
dimensions or use another grant's Column selection for a matching Scope.

**App contracts and membership.** Apps declare versioned administration
contracts naming owned Tables, their dimension relationships, dated assignment
sources and the Columns the resolver may read. Extend the existing declared-fact
reader with bounded set reads. The resolver returns facts, never an allow/deny
decision: target Person, correlated dimension tuples, assignment IDs, reporting
edges and effective periods. The platform validates the result and evaluates
Scope. Reject cycles, unresolved references, conflicting dimension derivations
and unsupported output; never turn them into all access. Dates use the instance
business date, start inclusive and end exclusive. Reporting traversal excludes
the holder; named departmental membership does not depend on reports_to.

Feather Dash declares Employee as its own Table linked to Person, with name,
employee_number, phone and emergency_contact Columns. It uses its existing
job_assignment, section, department and store Tables for membership; a section
supplies department where an assignment omits it. Explicit and derived dimensions
must agree. Employee has no copied store/department or account credential.
Operational contact writes never touch Person account Columns, sign_in_identity,
password/reset storage or person_identifier. Other apps declare different Tables,
Columns and membership contracts; no Dash role name appears in platform checks.

**Continuing authority and delegation.** Authority identifies an app-declared
office and Scope. A boundary names its required Access Admin role, action (grant
or revoke), target role, maximum Scope, recipient restriction and permitted
further delegation. The actor must currently occupy the office and hold the
required complete scoped role. A checked grant records the boundary/authority
and issuer separately. Descendants keep that provenance and are revalidated
against the current continuing boundary on every request. Reject provenance
cycles; an officeholder handover alone does not invalidate a grant. Each role
definition or binding change is evaluated as effective removals and additions
for its assignments. Protected generic CRUD cannot bypass these checks.

Job capability bindings name the roles and Scope projection a job confers. The
same grant/revoke checks cover appointment creation, replacement, deletion,
period extension or shortening, and acting appointments. Check future
appointments when saved and re-evaluate their provenance when effective.
Authorised expiry is automatic, not a new revocation act. A grant-only boundary
cannot remove powers; a revoke-only boundary cannot add them. Replacements
check both atomically. Trusted provisioning is the explicit root of authority;
an ordinary Administrator HTTP request is not provisioning.

**Held proposals and decisions.** App-owned configuration declares approval
rules with target operation/Columns, maker condition, Scope and outcome.
Approval rules compose after permission: gather every applicable mandatory
requirement, with approval taking precedence over apply-and-log. Every changed
Column needs a configured outcome on an approval-managed Table. Approve is an
independent scoped permission and may be narrower than read or update. A
reviewer also needs the rule's required current authority; no self approval.

Store held work in system-written Proposal, Proposal Change and Decision Tables.
A proposal identifies maker, target, operation, reviewed revision, version and
original/current/proposed values. Submission does not change the live Row or
emit its update event. A review names the exact proposal version; changed
affected values advance that version and require a fresh decision. Unrelated
Column changes do not manufacture a conflict. Rejection requires a reason.
Application locks/rechecks the proposal, maker, reviewer, rules, memberships,
provenance and affected values. Run the normal save hooks as the maker, under a
transaction-local approval context limited to the exact reviewed operation and
Columns. A hook that changes the reviewed correction cannot extend approval.
Record the maker, reviewer, authority and proposal in existing Version history.
Replay or concurrent review can apply a version at most once. Existing workflow
notification machinery delivers eligible reviewers' pending work; it does not
decide whether the proposal is authorised.

**Transactions and entry points.** Use one documented pre-row lock order for
authority configuration, membership sources, proposal and target Rows. Scope
reads must protect the membership set from inserts as well as existing-row
updates. Recompute authorisation after acquiring locks; an earlier request
snapshot is not proof after waiting for revocation. All participating public,
import, workflow and trusted mutation paths take the same locks and final checks.
Independent bulk Rows use actionTransaction/savepoints and return applied,
pending or rejected individually. A rejected Row rolls back its full hook chain
and queued effects, without rolling back another independent accepted Row.
Do not remove app decides_scope until these paths enforce its replacement.

## Context

See [proposal.md](proposal.md) for why this change is needed and the delta specs
for the business promises. This is the editable reference for the #462 walkthrough
and the next disposable HTML prototype. It is not a production migration or a
claim that the proposed tables exist. All people, stores, identifiers and contact
values below are synthetic examples, not client data.

Decision trail: the 28-Oct-2026 discussion and comments on
[#462](https://github.com/siraj-samsudeen/featherbase/issues/462), covering names
and capabilities; removal of app-table `decides_scope`; scope, delegation and
approvals; the plain-language example and conflicts; and job-derived delegation
limits. This document consolidates those decisions into one editable reference.

### Evidence from this checkout

These are reference points to inspect, not promises that source will stay static:

| Source | Relevant existing mechanism |
|---|---|
| `apps/server/src/security-tables.ts` | Explicit platform protection list plus `decides_scope`; both use the System Manager gate |
| `apps/server/src/permissions.ts` | Role resolution, operation flags, creator-only scope and basic/restricted tiers |
| `apps/server/src/document.ts`, `assertUserPermissions` | Data Scope narrowing currently returns early when no scope exists |
| `apps/server/migrations/0005_core_seeds.ts` | Existing Permission metadata |
| `openspec/specs/permissions-and-roles/spec.md` | Current platform lock, creator-only scope, sharing and sensitive-detail rules |
| `openspec/specs/app-roles-store-access/spec.md` | Fresh, fail-closed app-operation scope and complete object-scope checks |
| `openspec/specs/workflow-and-approvals/spec.md` | Workflow actions and waiting-for-approval notification mechanism |
| `openspec/changes/feather-dash-installed-app/design.md`, D5 | Earlier request-table design; the new owner decisions supersede its rejection of direct manager edits |

The proposed per-assignment scope cannot be substituted for `person_scope` or
existing app operation scope merely by returning a flattened list of stores.
Both the record footprint and each grant's boundaries must remain intact.

## Goals / Non-Goals

**Goals:** make the model understandable through a complete small journey;
record approved behaviour; choose explicit provisional defaults so a prototype
can run; keep platform enforcement generic and business relationships app-owned.

**Non-goals:** deploy, migrate the trial, finalise the app contract, build a live
permission editor, or treat the prototype as a secure server. The schema is a
logical proposal using metadata-defined Tables, not a mandate to hand-write
per-model SQL, routes or forms.

## Decisions

### Spec organisation: first adoption of #684

This change adopts the folder convention recorded in
[#684](https://github.com/siraj-samsudeen/featherbase/issues/684).
`permissions-and-roles` and `workflow-and-approvals` span platform, app and
instance responsibilities, so their existing root paths remain correct. Their
delta paths match those main-spec paths. No capability move is needed here.

Future area-specific capabilities use `platform/`, `app/`, `instance/` or
`apps/<app-name>/` without repeating the namespace as a prefix. Existing specs
are assessed as they are substantively worked on, not moved in a bulk sweep.
The authoring convention lives in `openspec/config.yaml`; it changes organisation,
not the behaviour in this change's delta specs or its implementation sequence.

### 1. Agreed vocabulary

| Term | Meaning | Concrete names |
|---|---|---|
| Platform Admin | Replacement name for System Manager; manages platform configuration, but needs explicit domain grants for app-owned business data | Platform Admin |
| App Admin | Administration of an app within declared powers; not an automatic grant of every domain permission | App Admin |
| Domain Data Admin | Maintain selected data with operation, column and scope restrictions | Store Layout Admin, Item Master Admin, HR Master Admin |
| Domain Data Approver | Decide proposed changes within authority | Store Layout Approver |
| Domain Data Access Admin | Confer bounded administrative authority | Store Layout Access Admin |
| Business job | Organisational responsibility that can carry several administrative capabilities | Store Manager, Department Manager |

These are responsibilities, not an inheritance ladder. An optional Role
`description` explains purpose and boundaries; permission records remain
assertions of authority. Do not repeat a mutable permission list in prose.

### 2. Agreed permission and scope structure

Use one Permission per `(role, target_table, operation)`, and Permission Column
rows for create, read and update. Delete is a whole-record operation. Preserve
submit/cancel/amend when migrating existing permissions; they are not silently
removed because the prototype demonstrates CRUD only.

Alternative: keep `can_read`, `can_write`, etc. on one Permission. It is compact
and not inherently a 3NF violation, but associating a distinct column set with
each operation is less direct. The owner selected per-operation records. Both
models can be shown as the same checkbox matrix.

Each role assignment has its own scope. Treat each grant as a complete proof:
operation, columns and scope must match together. Union complete grants; do not
cross-product one grant's columns with another's rows. Explicit unrestricted
scope is distinct from absent or unresolved scope; absent scope grants nothing.

Owner decision (2 November 2026): for ordinary shared employee contact details,
one current membership matching a complete authorised grant is enough. If Priya
works in Store A and Store B, Meera may maintain the permitted contact columns
through Store A; the shared correction is visible to both stores. Column limits
and approval rules still apply. This does not confer authority over Store B's
organisation or permit changes to job assignments outside the writer's scope.
Assignment changes still check both stored and proposed scope. Match an actual
membership tuple; never fabricate a store/department pair across assignments.

Owner decision (2 November 2026): a bulk submission of independent record changes
processes permitted rows and refuses forbidden rows, reporting each row's outcome.
For ten employee corrections with one outside scope, the nine permitted changes
proceed under their approval rules and the forbidden one stays unchanged. Report
applied, pending approval or rejected explicitly; acceptance is not application.
An individual row change remains atomic: a forbidden column cannot cause a partial
save of that row. This does not split an indivisible business operation into
independent writes. Define transaction/savepoint and retry mechanics during
implementation; no aggregate success response may hide partial refusal.

Owner decision: approval authority is independent of direct-edit permission. A
holder of scoped Employee Contact Approver authority may approve a valid correction
without Employee Contact Admin. Approval authorises only the reviewed proposal
and its permitted columns/records, never a general write. At application, recheck
the maker's current edit authority and the reviewer's current approval authority,
including scope and columns. No self-approval, stale overwrite or substituted
payload is permitted. Use an explicitly checked approval operation through the
normal validation/save/automation transaction, not an unrestricted bypass.
The exact approval-column representation remains an implementation contract.

Owner decision (3 November 2026): operational employee contact details are
separate from sign-in and account-recovery details. A domain contact correction
changes only the employee contact record, even if its old value matches an
account identifier. It neither updates sign-in/recovery identifiers nor grants
account-management rights. Account changes use their separate verified flow.
Employee-to-Person physical mapping remains implementation design; do not infer
that authentication secrets must live directly on the Person row.

Owner-approved initial sample field set (3 November 2026):

| Employee detail | R1 read | R1 update, subject to approval |
|---|---|---|
| C2 — Name | Yes | No |
| C3 — Employee number | Yes | No |
| C4 — Operational phone | Yes | Yes |
| C5 — Emergency contact | Yes | Yes |

This is the baseline example for Arun's RA6 grant, not a universal app restriction.
Other roles can select different columns. PM1/PM2 and their column associations
already express this set; the R7 phone-only variant remains a narrower example.

Scope modes: self (linked identity, not creator), direct reports, reporting
subtree (excluding self), named stores, named departments, and explicit all.
Named department grants do not follow their holder to a new department. Relative
reporting scopes intentionally change with current relationships. Store Staffing
Admin uses assigned-store scope, independent of a clean reporting tree.

Create checks the proposed record; read/delete check the stored record; update
checks the stored and proposed record and relevant linked destinations. Transfers
require authority over both sides. Business constraints still apply even when
permission exists. Multi-row target selection does not widen authority.

### 3. Agreed protection boundaries

Remove `decides_scope` for app tables once the replacement is enforced. Retain
platform access configuration and system-written audit protections separately.
The agreed rename is System Manager to Platform Admin, not an implicit decision
to expand its powers over app data.

Coverage follows dated business assignments and section/subcategory membership.
An authorised organisational correction is supposed to change report access.
Administrative scope is separate from that viewing scope.

Job assignments that confer administrative capabilities are also delegation
acts. Check every newly conferred capability, recipient, scope and delegation
power against the actor's boundary. This applies to acting and changed jobs,
not only explicit grants. Evaluate after hooks and before commit. A staffing
permission alone is insufficient to appoint another Access Admin. Central-only
appointments are an optional business policy, not a replacement for this check.

Ending, deleting or narrowing a capability-bearing job also requires scoped
revoke authority, independently configured from grant authority (owner decision,
3 November 2026). Apply the same removal check to explicit grants and to shared
role or binding changes that remove effective powers. Grant-only authority
cannot revoke; revoke-only authority cannot grant. An atomic transfer or role
replacement checks removals and additions separately, before either applies.

### 4. Agreed delegation and approval semantics

Delegation references a continuing authority (for example Store Manager of
Store A) and separately records the issuing person. Successors inherit oversight,
not a fictitious claim that they issued earlier grants. Revocation and narrower
parent authority constrain descendants on the next request. No further delegation
without an explicit boundary that permits it.

Approval is separate from permission. A valid proposal must first be permitted;
mandatory rules are gathered across all applicable grants/conditions, so a second
permission cannot bypass them. Approval beats immediate application; independent
requirements all apply unless an explicit alternative is configured. No maker
approves their own held proposal. A manager's immediate changes use an explicit
apply-and-log rule.

Before applying, recheck maker, approver and original/proposed scope. A changed
affected value invalidates prior review: show original/current/proposed values
and obtain a new decision. A proposal is not a permanent authorisation token.

### 5. Prototype defaults, not owner-ratified production schema

The owner authorised choosing reasonable defaults to make the prototype usable.
The following defaults are editable here and must not be represented as settled
production architecture:

- The proposed physical mapping is app-owned Employee linked to platform Person.
  Separation of operational contacts from sign-in/recovery details is now agreed;
  exact account-table and column mapping must follow the current platform model.
- App metadata is represented below as small relational logical tables. Physical
  storage names, reference types and migration ordering remain design work.
- The app exposes a read-only membership resolver and a job-capability resolver.
  The generic platform evaluates their structured results. No arbitrary SQL or
  executable rule expressions are entered by business users.
- A responsibility template offers fixed read/update sets in the prototype.
  Narrower column combinations are represented by a new reusable role in this
  first model, rather than silently modifying a role shared by other grantees.
- Current membership uses the instance business date with exclusive end dates.
  Historical reporting uses its requested date but cannot rewrite past authority.
- The discarded prototype was a browser-only experiment; it supplied no server
  enforcement, real credential changes or database verification.

## Proposed logical records

This is the database view for the prototype. Link displays use **ID — Name**;
foreign-key values store the ID, not the concatenated label. Job Assignment IDs
start with **JA**. PK means primary key; FK means reference.

| Record | Suggested fields and keys | Created/populated by |
|---|---|---|
| Role | id PK, name, description optional, owner_app FK nullable | Platform/app registration |
| Permission | id PK, role FK, target_table metadata FK, operation; unique role/table/operation | App declaration |
| Permission Column | permission FK, target_column metadata FK; unique pair; column belongs to target table | App declaration |
| Scope Definition | id PK, mode, resolver FK optional; referenced dimensions | Platform modes + app declarations |
| Scope | id PK, definition FK; scope tuple children | Instance configuration |
| Scope Tuple | id PK, scope FK; condition children | Instance configuration |
| Scope Condition | tuple FK, dimension, referenced value; unique tuple/dimension | Instance configuration |
| Role Assignment | id PK, person FK, role FK, scope FK, source_job_assignment FK nullable, source_authority FK nullable, grantor FK, status | Bootstrap, checked job binding, delegated grant |
| Authority | id PK, office_job FK, office_scope FK, status | Trusted instance setup |
| Delegation Boundary | id PK, authority FK, required_access_role FK, action (grant or revoke), target_role FK, max_scope FK, recipient_rule, allow_further_delegation | Trusted configuration; grant and revoke are separate boundary records |
| Job Capability | id PK, job FK, role FK, scope_projection | App binding configured per instance |
| Resolver Declaration | id PK, app FK, target_table metadata FK, contract name/version | App declaration |
| Approval Rule | id PK, target_table FK, operation, maker_condition, outcome, approver_authority FK nullable, combination | App/authorised configuration |
| Approval Rule Column | rule FK, column metadata FK | Authorised configuration |
| Proposal | id PK, target_table FK, record FK, maker FK, status, version | Permitted edit awaiting approval |
| Proposal Change | proposal FK, column FK, original_value, proposed_value, review_base_value | Proposal creation/fresh review |
| Decision | id PK, proposal FK, reviewed_version, reviewer FK, outcome, reason, time | Approval/rejection |
| History | actor, maker if applicable, authority, record, old/new values, event, time | System only |

For named scopes, conditions within a tuple are AND; multiple tuples are OR.
Thus `(Store A, Homeware) OR (Store B, Clothing)` never means Homeware in Store B.
A single-store scope may omit department; a missing whole Scope never means all.
Self/reporting modes bind to the assignment holder, with optional tuple bounds.
Delegation evaluates scope containment, not merely matching scope labels.

Authority is a protected representation of an office, not an extra business job.
The actor must currently occupy it and possess the boundary's required Access
Admin role. Possessing an office or a direct maintenance role alone is not enough.
Platform access storage remains protected; a dedicated checked grant operation
writes scoped assignments. Ordinary CRUD on Role, Permission or account holdings
cannot bypass that operation. Reuse metadata/save history rather than a raw write
path that skips hooks.

## Complete synthetic seed journey

These tables define the bounded contact-maintenance example, including its
bootstrap root. They are not a seed pack for a real client or an exhaustive list
of roles every app might declare. Rows added during interaction are shown after
initial setup, rather than pre-seeding an already completed approval.

### A. Bootstrap the platform

Platform metadata creates the generic records above before populating them.
Initial identity provisioning is a trusted bootstrap act, not a manager granting
themselves platform authority.

**Person**

| ID | Name | Enabled |
|---|---|---|
| P0 | Asha | Yes |
| P1 | Meera | Yes |
| P2 | Arun | Yes |
| P3 | Priya | Yes |
| P4 | Ravi | Yes |
| P5 | Leela | Yes |

P0 is provisioned first; P1–P5 arrive during instance setup. No passwords or real
contact information are part of this sample.

**Platform Role / Scope / Assignment**

| Record | ID | Values |
|---|---|---|
| Role | R0 | Platform Admin; platform-owned; administer platform configuration |
| Scope Definition | SD0 | Explicit unrestricted platform scope |
| Scope | SC0 | SD0 — Explicit unrestricted platform scope |
| Role Assignment | RA0 | P0 — Asha; R0 — Platform Admin; SC0 — Platform scope; trusted bootstrap source |

R0's protected bootstrap capabilities are a platform primitive, not ordinary
app Permission rows granting write access to the security configuration. This
sample makes no new decision about universal Platform Admin access to app data.

### B. Install the app's metadata and reusable permissions

**Installed App**: APP1 — Example Store App. This synthetic app stands in for
Feather Dash in public fixtures. The product use case is Feather Dash; no client
package, real hostname or client-specific value is introduced here.

**App table/column metadata** (logical IDs used by all permission references)

| Table ID — Name | Column IDs — Names |
|---|---|
| T1 — Employee | C1 — person; C2 — name; C3 — employee_number; C4 — phone; C5 — emergency_contact |
| T2 — Job Assignment | C6 — person; C7 — job; C8 — store; C9 — department; C10 — section; C11 — reports_to; C12 — acting; C13 — starts_on; C14 — ends_on |
| T3 — Store | C15 — name |
| T4 — Department | C16 — store; C17 — name |
| T5 — Section | C18 — store; C19 — department; C20 — name |

Generated row IDs, creation times and revisions are system-owned. C2 is the
employee display name for this synthetic example, not an identity-matching key.
Other platform/app metadata required to install a real package is outside this
bounded permission simulation, not an omitted authority grant.

**Role** (all owned by APP1 — Example Store App)

| ID | Name | Description |
|---|---|---|
| R1 | Employee Contact Admin | Maintain employee contact details, not assignments or access rights |
| R2 | Employee Contact Approver | Review proposed employee contact corrections |
| R3 | Employee Contact Access Admin | Grant bounded employee contact maintenance responsibility |
| R4 | Store Staffing Admin | Maintain job assignments within authorised stores |
| R5 | Store Staffing Access Admin | Confer the explicitly permitted staffing-related capabilities |
| R6 | Employee Self-Service | Maintain selected personal contact details |

Store Layout Admin, Item Master Admin and HR Master Admin are agreed naming
patterns, but unused roles are not seeded merely to fill the catalogue.
App Admin is also not needed to complete this journey.

**Permission**

| ID | Role | Target | Operation | Column selection |
|---|---|---|---|---|
| PM1 | R1 — Employee Contact Admin | T1 — Employee | Read | C2 — name; C3 — employee_number; C4 — phone; C5 — emergency_contact |
| PM2 | R1 — Employee Contact Admin | T1 — Employee | Update | C4 — phone; C5 — emergency_contact |
| PM3 | R4 — Store Staffing Admin | T2 — Job Assignment | Read | C6–C14 — all declared assignment details |
| PM4 | R4 — Store Staffing Admin | T2 — Job Assignment | Create | C6–C14 — all declared assignment details |
| PM5 | R4 — Store Staffing Admin | T2 — Job Assignment | Update | C6–C14 — all declared assignment details |
| PM6 | R6 — Employee Self-Service | T1 — Employee | Read | C2 — name; C3 — employee_number; C4 — phone; C5 — emergency_contact |
| PM7 | R6 — Employee Self-Service | T1 — Employee | Update | C4 — phone |

Each listed selection expands to one Permission Column row per referenced column.
For example PM2 has exactly `(PM2, C4)` and `(PM2, C5)`. R2/R3/R5 grant no ordinary
CRUD by themselves; they are checked by the approval/delegation mechanisms below.
No Delete permission exists in this fixture. Approval read access comes from R1.

### C. Load organisational data and dated jobs

**Store / Department / Section / Job**

| Record | ID — Name | Links |
|---|---|---|
| Store | S1 — Store A | — |
| Store | S2 — Store B | — |
| Department | D1 — Homeware | S1 — Store A |
| Department | D2 — Clothing | S1 — Store A |
| Department | D3 — Homeware | S2 — Store B |
| Section | SEC1 — Homeware Essentials | S1 — Store A; D1 — Homeware |
| Section | SEC2 — Clothing Essentials | S1 — Store A; D2 — Clothing |
| Section | SEC3 — Homeware Essentials | S2 — Store B; D3 — Homeware |
| Job | JOB1 — Store Manager | — |
| Job | JOB2 — Department Manager | — |
| Job | JOB3 — Team Leader | — |

Job and section integrity enforce that a department/section belongs to the stated
store. Floors are not needed for this contact-maintenance seed. They remain part
of #449, not a prerequisite artificially inserted into this example.

**Employee**

| ID — Name | Person | Employee number | Phone | Emergency contact |
|---|---|---|---|---|
| E1 — Meera | P1 — Meera | DEMO-001 | demo-phone-meera | demo-contact-meera |
| E2 — Arun | P2 — Arun | DEMO-002 | demo-phone-arun | demo-contact-arun |
| E3 — Priya | P3 — Priya | DEMO-003 | demo-phone-priya-old | demo-contact-priya |
| E4 — Ravi | P4 — Ravi | DEMO-004 | demo-phone-ravi | demo-contact-ravi |
| E5 — Leela | P5 — Leela | DEMO-005 | demo-phone-leela | demo-contact-leela |

No store or department is copied onto Employee. Synthetic strings avoid real
phone numbers; a production phone-format validator is outside this prototype.

**Job Assignment** (end dates exclusive; all start 01-Oct-2026)

| ID | Person | Job | Store | Department | Section | Reports to | Acting | Ends |
|---|---|---|---|---|---|---|---|---|
| JA1 | P1 — Meera | JOB1 — Store Manager | S1 — Store A | — | — | — | No | — |
| JA2 | P2 — Arun | JOB2 — Department Manager | S1 — Store A | D1 — Homeware | — | P1 — Meera | No | — |
| JA3 | P3 — Priya | JOB3 — Team Leader | S1 — Store A | — | SEC1 — Homeware Essentials | P2 — Arun | No | — |
| JA4 | P4 — Ravi | JOB3 — Team Leader | S1 — Store A | — | SEC2 — Clothing Essentials | P1 — Meera | No | — |
| JA5 | P5 — Leela | JOB3 — Team Leader | S2 — Store B | — | SEC3 — Homeware Essentials | — | No | — |

Priya's department comes through SEC1; Arun's comes directly from JA2. The
resolver returns correlated membership facts, not independent sets of stores
and departments. The demonstration business date is 28-Oct-2026.

### D. Register scope definitions, bindings and the initial authority

**Resolver Declaration**

| ID | App | Target | Contract |
|---|---|---|---|
| RES1 | APP1 — Example Store App | T1 — Employee | Current employee memberships: employee → person → effective assignments → department directly or through section |
| RES2 | APP1 — Example Store App | T2 — Job Assignment | Assignment footprint: stored/proposed store, department and section relationships |
| RES3 | APP1 — Example Store App | T2 — Job Assignment | Job capabilities conferred: job binding + assignment scope + effective period |

These are proposed extension contracts under #617, not installed platform APIs.
Read-only resolution cannot mutate or authorise itself. Cycles, missing references
or ambiguous unsupported results fail closed. A future appointment is checked
when written and must be re-evaluated when it becomes effective.

**Scope Definition / Scope**

| Definition | Mode | Resolver |
|---|---|---|
| SD1 — Organisation | Correlated named store/department tuples | RES1 for Employee; RES2 for Job Assignment |
| SD2 — Self | Employee.person equals assignment holder | Identity relationship, no creator check |
| SD3 — Direct reports | Current assignment reports_to equals holder, with tuple bounds | RES1 |
| SD4 — Reporting subtree | Transitive reports, excluding holder, with tuple bounds | RES1 |

| Scope ID — Name | Definition | Tuple conditions |
|---|---|---|
| SC1 — Store A | SD1 — Organisation | ST1: Store = S1 — Store A |
| SC2 — Store A Homeware | SD1 — Organisation | ST2: Store = S1 — Store A AND Department = D1 — Homeware |
| SC3 — Own employee | SD2 — Self | No named tuple required; holder is mandatory |
| SC4 — Store A direct reports | SD3 — Direct reports | ST4: Store = S1 — Store A |
| SC5 — Store A reporting subtree | SD4 — Reporting subtree | ST5: Store = S1 — Store A |

ST1/ST2/ST4/ST5 are Scope Tuple rows; each dimension=value expands to one Scope
Condition row. SC4/SC5 demonstrate selectable modes but are not granted initially.

**Job Capability**

| ID | Job | Role | Scope projection |
|---|---|---|---|
| JC1 | JOB1 — Store Manager | R1 — Employee Contact Admin | Assignment's store |
| JC2 | JOB1 — Store Manager | R2 — Employee Contact Approver | Assignment's store |
| JC3 | JOB1 — Store Manager | R3 — Employee Contact Access Admin | Assignment's store |
| JC4 | JOB1 — Store Manager | R4 — Store Staffing Admin | Assignment's store |

JOB2/JOB3 confer no administrative roles in this sample. Their report coverage
still derives from their work assignments. R5 is deliberately not conferred on
Meera, making the acting-manager escalation scenario observable.

**Authority / Delegation Boundary**

| ID | Values |
|---|---|
| AU1 — Store A management | JOB1 — Store Manager; SC1 — Store A; active; current holders resolved from dated assignments |
| DB1 — Contact maintenance delegation | AU1 — Store A management; required R3 — Employee Contact Access Admin; may grant R1 — Employee Contact Admin; maximum SC1 — Store A; recipients currently assigned to Store A; no further delegation |
| DB2 — Contact maintenance revocation | AU1 — Store A management; required R3 — Employee Contact Access Admin; may revoke R1 — Employee Contact Admin; maximum SC1 — Store A; recipients currently assigned to Store A; configured separately from DB1 |

Trusted instance setup by P0 creates the initial office, binding configuration,
JA1 and grants. This is the explicit root of trust; Meera cannot bootstrap her
own authority through an unchecked job row. Ordinary Access Admins use the
bounded grant operation, not ordinary writes to this protected configuration.

**Initial effective Role Assignments**

| ID | Person | Role | Scope | Source | Recorded issuer |
|---|---|---|---|---|---|
| RA1 | P1 — Meera | R1 — Employee Contact Admin | SC1 — Store A | JA1 + JC1 | P0 — Asha |
| RA2 | P1 — Meera | R2 — Employee Contact Approver | SC1 — Store A | JA1 + JC2 | P0 — Asha |
| RA3 | P1 — Meera | R3 — Employee Contact Access Admin | SC1 — Store A | JA1 + JC3 | P0 — Asha |
| RA4 | P1 — Meera | R4 — Store Staffing Admin | SC1 — Store A | JA1 + JC4 | P0 — Asha |
| RA5 | P2 — Arun | R6 — Employee Self-Service | SC3 — Own employee | Explicit setup grant | P0 — Asha |

These job-derived assignments may be computed views rather than persisted rows;
the prototype shows stable IDs to make the explanation inspectable. Do not persist
stale capabilities without rechecking their source job and binding.

### E. Configure approval before accepting delegated edits

| Rule | Target / operation | Details | Maker condition | Outcome |
|---|---|---|---|---|
| AR1 — Store manager corrections | T1 — Employee / Update | C4 — phone; C5 — emergency_contact | Current AU1 holder, target fully in SC1 | Apply and log |
| AR2 — Delegated corrections | T1 — Employee / Update | C4 — phone; C5 — emergency_contact | Authorised non-officeholder changing another person's record in SC1 | Require current AU1 holder with R2 approval authority covering the affected records/columns; R1 not required |
| AR3 — Self contact maintenance | T1 — Employee / Update | C4 — phone | Maker is linked person, holds R6, scope SC3 | Apply and log |

Each Details selection expands into Approval Rule Column rows. Delegation has no
permission to edit these rules. If no explicit outcome covers a proposed edit,
the prototype refuses it as unconfigured rather than silently applying it. Rules
for unrelated staffing operations are not supplied by these contact rules.

A synthetic protected-detail rule can be added in the prototype to demonstrate
that mandatory approval overrides AR3; it is not a pre-approved HR identity policy.
Use the existing workflow waiting-for-approval mechanism for real notifications,
not a second notification system. The prototype displays pending work locally.

### F. Meera delegates to Arun

Check RA3, AU1 current occupancy, DB1 recipient eligibility and role/scope bounds.
Then add one assignment (SC2 and its conditions already exist):

| ID | Person | Role | Scope | Authority | Granted by | Further delegation |
|---|---|---|---|---|---|---|
| RA6 | P2 — Arun | R1 — Employee Contact Admin | SC2 — Store A Homeware | AU1 via DB1 | P1 — Meera | No |

Record H1 — grant issued by P1 under AU1 for RA6. In plain language: Arun may
maintain contact details for Homeware in Store A, with Store Manager approval for
others' records. E3 — Priya matches; E4 — Ravi and E5 — Leela do not. E2 — Arun is
also in Homeware but his self phone edit is governed by RA5/AR3, not self-approval.

### G. Arun proposes; Meera approves

| Record | ID | Values |
|---|---|---|
| Proposal | CP1 | T1 — Employee; E3 — Priya; maker P2 — Arun; pending; version 1 |
| Proposal Change | CP1 / C4 | original = demo-phone-priya-old; proposed = demo-phone-priya-new; review base = demo-phone-priya-old |
| History | H2 | P2 — Arun submitted CP1; live E3 unchanged |

Meera has RA2 and RA1. Recheck Arun's RA6, Meera's current office and roles,
current membership and proposal version; then add:

| Record | ID | Values |
|---|---|---|
| Decision | DEC1 | CP1 version 1; reviewer P1 — Meera; approved; review base still matches |
| Employee update | E3 / C4 | demo-phone-priya-new |
| Proposal update | CP1 | applied |
| History | H3 | E3 phone old → new; maker P2 — Arun; approver P1 — Meera; CP1 / DEC1 |

Store actual timestamps, displayed in the instance's agreed format. Each action
is one transaction; a replay cannot apply the proposal twice. Rejection instead
adds a rejected Decision with a reason and leaves E3 unchanged.

### H. Branches to exercise from the initial seed

Reset to the seed between independent branches; these rows are not all active at
once. Do not mix an already approved CP1 with a test that requires it pending.

| Branch | Concrete mutation / attempted action | Expected result |
|---|---|---|
| Read-only detail | Arun changes E3's C3 — employee_number | Refuse; no partial phone save either |
| Wrong department | Arun changes E4 — Ravi's phone | Refuse; no target disclosure beyond authorised data |
| Wrong store | Arun changes E5 — Leela's phone | Refuse |
| Missing reporting line | Clear JA3 reports_to | E3 remains in SC2 through SEC1; department scope still works |
| Dated transfer | End JA3 on 01-Nov-2026; JA6 assigns P3 to JOB3 / S1 / SEC2 from 01-Nov-2026 | E3 matches SC2 on 28-Oct, not on 01-Nov |
| Scope revocation | Revoke RA6 with CP1 pending | Arun's next request refuses; CP1 cannot apply |
| Conflict | Meera directly changes E3 phone to demo-phone-priya-current while CP1 waits | CP1 requires fresh review of original/current/proposed; DEC1 cannot blindly apply |
| Handover | End JA1 on 01-Nov; trusted setup appoints P4 — Ravi through JA7 to JOB1 / S1 from that day | RA6 continues under AU1; Ravi gains valid job-derived R1–R4; Meera loses them absent another grant |
| Indirect escalation | Meera attempts JA8: P4 — Ravi, JOB1 — Store Manager, S1, acting | Refuse before job/capability writes: Meera cannot confer R2/R3/R4 through DB1 |
| Grant escalation | Meera tries to grant R3 to Arun through DB1 | Refuse: only R1 is grantable |
| Self + department | Arun reads his employee number and changes his own phone | Read succeeds; AR3 permits phone update; no authority to change another employee number |
| Direct-report mode | Replace RA6 scope with SC4 | Members follow reports_to within S1; missing JA3 reports_to excludes Priya |

## Prototype status and current verification direction

The disposable simulation has been discarded at the owner’s request. The owner
did not finish reviewing it; it is not a takeover artifact. No further UI development or
UI acceptance is required for this handoff. Presentation experiments do not amend
production behaviour or settle the defaults listed above.

The next deliverable is backend verification with the named sample data, following
the handoff section and tasks. Keep business-facing UI work outside this change
unless the owner later requests it. Generic existing screens may still be used
for a smoke check; they are not the primary proof of permission enforcement.

## Production admission and migration plan

This is a staged design, with explicit gates before implementation tasks below:

1. Validate the sample-data cases against the business example and revise these artifacts.
   Use the approved sample field set. Apply the agreed per-row bulk outcomes and shared
   contact policy (one authorised membership is sufficient). Implement independent approval authority; resolve role-definition changes,
   binding changes and multi-level delegation termination under #617/#627.
2. Finish the app contracts and a concrete schema migration plan. Job binding
   changes can themselves widen authority and must trigger the same checks as job
   appointments. Time activation and revocation must be transactionally fresh.
3. Claim migration numbers under #566. Convert operation flags/tiers into explicit
   permission/column records, preserve creator-only permissions as a distinct mode,
   and convert role assignments/scopes without widening them. No aliases or dual
   write compatibility layer. Reconcile the proposed app model with existing
   sharing, app entry gates and preflight before removing any old protection.
4. Prove ordinary and imported writes, hooks, workflow actions, bulk operations,
   job-derived grants, role-definition edits and approval application use the
   same authority boundary. Scope proofs and proposal values must survive lock
   waits and concurrent revocations without stale authorisation.
5. Remove app `decides_scope` checks only when those replacements pass. Keep
   platform security configuration and system-written guards. Rename the role
   consistently in metadata, code, grants, docs and all affected main-spec deltas.
6. Rehearse any trial-data migration on a restored snapshot with the target's
   actual environment settings and follow `docs/DEPLOY.md`. Rollback means a
   coordinated code/database restore, not running old code on a rewritten schema.

The existing spec's broad System Manager exception, optional Data Scope semantics
and row sharing need an explicit implementation mapping. This draft changes app
administrative authority; it does not silently reinterpret all legacy grants.
The sensitive-detail delta intentionally replaces silent discard for ordinary
ungranted details with refusal; secret-field behaviour stays separately protected.
The platform-lock delta intentionally replaces the blanket app-data lock while
retaining protections against ordinary account/role edits and automation bypass.

## Risks / Trade-offs

- **Business complexity** → offer named responsibilities and a plain-language
  summary; leave relational details in an optional prototype inspection view.
- **Scope drift and timing** → resolve current membership and authority freshly;
  lock/check dependencies when applying changes; never trust browser-selected scope.
- **Indirect privilege escalation** → treat jobs, bindings and edits to shared
  role definitions as authority-changing operations, not only explicit grants.
- **Persistent delegation cycles** → require provenance and bounded acyclic
  delegation; prototype allows only one delegated level.
- **Over-broad app grants** → manifest ownership, protected grant configuration,
  install review and preflight remain; removing a flag is not removing enforcement.
- **A complete-looking fixture hiding missing production work** → mark prototype
  defaults and gates; seed is complete for this bounded scenario, not every app.

## Open Questions

Resolve the production gates above: physical Employee/Person mapping, resolver
and capability contracts, approval-authority representation and migration mapping. UI presentation questions are no longer part of
this handoff. Owner review of the simulation was not completed.
