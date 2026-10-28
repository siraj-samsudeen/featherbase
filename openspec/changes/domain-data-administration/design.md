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
| Platform Admin | Proposed replacement name for System Manager; exact business-data powers are not inferred from the name | Platform Admin |
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

- Employee is app-owned and references platform Person. Phone and emergency
  contact live on Employee; sign-in and platform secrets remain on Person.
- App metadata is represented below as small relational logical tables. Physical
  storage names, reference types and migration ordering remain design work.
- The app exposes a read-only membership resolver and a job-capability resolver.
  The generic platform evaluates their structured results. No arbitrary SQL or
  executable rule expressions are entered by business users.
- A responsibility template offers fixed read/update sets in the prototype.
  Narrower column combinations are represented by a new reusable role in this
  first model, rather than silently modifying a role shared by other grantees.
- Approval requires both an Approver assignment and authority to apply the
  affected update. The example gives Meera both. Approver-only application needs
  an explicit production decision, not a hidden privileged writer.
- Reject an entire bulk request containing an unauthorised target. This is a
  conservative prototype default; the owner has not separately approved generic
  CRUD bulk semantics (existing app store operations already refuse mixed scopes).
- Current membership uses the instance business date with exclusive end dates.
  Historical reporting uses its requested date but cannot rewrite past authority.
- If a shared Employee record resolves to several simultaneous memberships, the
  prototype requires the complete footprint to be covered. Do not fabricate a
  store/department pair by mixing two different assignments. The broader policy
  for cross-store personal data must be confirmed before production.
- The prototype uses in-memory state with optional local reset and no real API,
  notifications, credentials or database writes. It is an interaction experiment.

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
| Delegation Boundary | id PK, authority FK, required_access_role FK, grantable_role FK, max_scope FK, recipient_rule, allow_further_delegation | Trusted configuration |
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
| P0 | Bootstrap Administrator | Yes |
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
| Role Assignment | RA0 | P0 — Bootstrap Administrator; R0 — Platform Admin; SC0 — Platform scope; trusted bootstrap source |

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

Trusted instance setup by P0 creates the initial office, binding configuration,
JA1 and grants. This is the explicit root of trust; Meera cannot bootstrap her
own authority through an unchecked job row. Ordinary Access Admins use the
bounded grant operation, not ordinary writes to this protected configuration.

**Initial effective Role Assignments**

| ID | Person | Role | Scope | Source | Recorded issuer |
|---|---|---|---|---|---|
| RA1 | P1 — Meera | R1 — Employee Contact Admin | SC1 — Store A | JA1 + JC1 | P0 — Bootstrap Administrator |
| RA2 | P1 — Meera | R2 — Employee Contact Approver | SC1 — Store A | JA1 + JC2 | P0 — Bootstrap Administrator |
| RA3 | P1 — Meera | R3 — Employee Contact Access Admin | SC1 — Store A | JA1 + JC3 | P0 — Bootstrap Administrator |
| RA4 | P1 — Meera | R4 — Store Staffing Admin | SC1 — Store A | JA1 + JC4 | P0 — Bootstrap Administrator |
| RA5 | P2 — Arun | R6 — Employee Self-Service | SC3 — Own employee | Explicit setup grant | P0 — Bootstrap Administrator |

These job-derived assignments may be computed views rather than persisted rows;
the prototype shows stable IDs to make the explanation inspectable. Do not persist
stale capabilities without rechecking their source job and binding.

### E. Configure approval before accepting delegated edits

| Rule | Target / operation | Details | Maker condition | Outcome |
|---|---|---|---|---|
| AR1 — Store manager corrections | T1 — Employee / Update | C4 — phone; C5 — emergency_contact | Current AU1 holder, target fully in SC1 | Apply and log |
| AR2 — Delegated corrections | T1 — Employee / Update | C4 — phone; C5 — emergency_contact | Authorised non-officeholder changing another person's record in SC1 | Require AU1 holder with R2 and current apply authority |
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

## Prototype interaction plan

Default to a business-facing flow, with an optional inspectable data view:

1. **Responsibilities:** as Meera, select Arun, contact maintenance, Store A and
   Homeware; show the resulting plain-language authority statement before saving.
2. **Employees:** switch to Arun, see only authorised records and readable details;
   permitted edits create proposals; read-only details remain visibly read-only.
3. **Approvals:** switch to Meera; review original/proposed values, approve or
   reject with a reason. Show that live data stays unchanged until approval.
4. **Try a situation:** isolated controls for transfer date, revocation, conflict,
   handover and the acting-manager escalation. Explanations identify the rule,
   without implying inaccessible data is visible in the real user's screen.
5. **Behind the scenes:** read-only sample records using ID — Name links, grouped
   in bootstrap/install/setup/delegate/propose/decide order. This is a prototype
   teaching aid, not a required business workflow.

Use synthetic data, clear local-only labelling and a reset. Follow Shop Floor
visual direction. Owner edits to these artifacts drive the next version. No
production implementation starts merely because the prototype feels plausible.

## Production admission and migration plan

This is a staged design, with explicit gates before implementation tasks below:

1. Validate the prototype against the business example and revise these artifacts.
   Confirm the HR field set, generic bulk semantics and cross-store personal-record
   footprint policy. Resolve approver-only authority, role-definition changes,
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

Non-blocking presentation details for prototype review: whether the permissions
matrix appears inline or as an expandable section, and the most understandable
wording for the responsibility summary. Production policy and contract gates are
listed above rather than disguised as minor unanswered implementation details.
