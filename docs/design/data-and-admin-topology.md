# Featherbase Data & Administration Topology — Design Framework

> Status: **design framework, 2026-07-26** — follows the research in
> `docs/research/frappe-multi-app-multi-db.md` and deliberately steps away
> from Frappe's design where it is weak. This is the organizing document:
> it sorts a broad set of real client requirements into orthogonal axes so
> each future spec/ADR addresses exactly one. §6 lists the decisions to
> ratify and a sequencing. Nothing here is implemented; nothing here has to
> land at once.

## 0. The requirements being organized (verbatim intent)

- Helpdesk: Finance and Legal each run a helpdesk on the *same* application
  with *different* ticket types, some ticket types shared company-wide; a
  generic ticket is created by someone who doesn't know where it belongs and
  is routed to a department, where ~100 specific types exist. Each
  department has its own admin (create ticket types, SLAs); above them a
  company-wide admin. Departments inside Finance (accounting, advance
  payments, recon) feel like *modules*. Question: how does this generalize
  to ERP?
- Storage: everything could sit in a single database (one schema, several
  schemas, or several DBs in one Postgres instance) — OR the data lives
  elsewhere and we overlay/mirror:
  - SAP master data: our UI + our DB is where authoring happens, synced to
    SAP periodically or on every write (client's SAP UI/Fiori development is
    too painful).
  - SaaS products: master data synced back and forth (bidirectional).
  - Control plane in Railway Postgres: external DB is the live source, we
    overlay a UI (spec exists: `docs/specs/external-database-doctypes.md`).
  - Config CSVs in a GitHub repo (e.g. which tables/fields enter a
    bronze/silver layer), currently edited by agents; clients need a UI
    **without losing git diffability**.
- Naming: no forced `tab` prefix — adopt existing tables under their own
  names via a reflection API; optionally add `created_by` / `created_at`
  style columns. Refactoring (renames) must stay possible.
- Priorities: single app now (an MDM product) with multiple modules,
  module-level admin + app-level admin. Multi-app later. Multi-site /
  multi-tenant is **not** a key requirement — the existing site concept can
  be repurposed if ever needed.

## 1. Three orthogonal axes

Every requirement above lands cleanly on one of three independent axes.
Keeping them independent is the design: any DocType picks a position on
each axis, and no axis constrains another.

- **Axis A — Organization & delegation.** Who administers what: apps,
  modules, scoped metadata authoring, scoped data visibility, shared vs
  departmental types. (The helpdesk/ERP/admin thread.)
- **Axis B — Storage & system of record.** Where a DocType's rows
  physically live, who is authoritative, and how changes propagate.
  (Local PG / SAP mirror / Railway overlay / CSV-in-git thread.)
- **Axis C — Physical naming & augmentation.** What we impose on tables we
  touch: naming policy, reflection, opt-in audit columns, refactoring.
  (The anti-`tab_` thread.)

Multi-tenancy (PLAT-008 sites) is parked: it is orthogonal to all three,
already works, and is explicitly not a key requirement.

---

## 2. Axis A — Organization & delegated administration

### 2.1 The hierarchy

```
App  (helpdesk, mdm, erp)          ← deployable functionality; app admin
 └─ Module (finance, legal, recon…) ← ADMIN DELEGATION BOUNDARY, not a label
     ├─ Types (ticket types, doc subtypes)  ← module admin authors these
     ├─ Config records (SLAs, routing, approval rules)
     └─ Data rows (tickets…), scoped by a module/department dimension
```

Today `module` in Featherbase is only a sidebar grouping. The upgrade this
axis demands: **module becomes a first-class scope** with (a) an admin role
per module, (b) metadata-authoring permissions checked against it, and
(c) an optional row-scoping dimension on transactional DocTypes enforced by
the permission layer.

### 2.2 The delegation matrix

| Capability | Platform admin | App admin | Module admin | End user |
|---|---|---|---|---|
| Create/alter any DocType, connections, apps | ✔ | | | |
| App-wide DocTypes, global types, cross-module routing rules | ✔ | ✔ | | |
| Create **types** (field-sets) within own module, SLAs, module roles, assignment rules | ✔ | ✔ | ✔ | |
| Author/act on records per role & scope | ✔ | ✔ | ✔ | ✔ |

The key distinction: a module admin does **not** create free-standing
DocTypes (no new tables); they create *types* of the app's base entities —
metadata that composes onto an existing storage shape. That keeps delegated
power away from DDL.

### 2.3 Types: base entity + scoped field-sets (the helpdesk answer)

The generic-ticket-then-routed workflow rules out one-DocType-per-ticket-type
(rows would have to migrate between tables on routing; 100 types × N
departments = metadata explosion — this is Frappe's weakness). Instead:

- **One base DocType per domain entity** (`Ticket`) holding the common
  fields (subject, requester, status, department, SLA fields).
- **A Type registry DocType** (`Ticket Type`): each row is owned by a scope
  (`global` or a module) and carries a *field-set* — extra field
  definitions, conditional layout, its own SLA/routing defaults, and
  per-type permissions.
- Physically the extra fields are sparse columns (or a typed `jsonb`
  section) on the base table — Featherbase's existing Custom Fields
  machinery (`custom-fields.ts`) already adds columns at runtime, so the
  mechanism exists; this reuses it under module-admin control.
- **Routing = updating the type (and department) fields on the same row.**
  Data survives, history survives, nothing migrates.
- Commonality: `global`-scoped types are visible everywhere; module-scoped
  types only inside their module. The intake form shows the generic global
  type to people who "don't know where it belongs".

Precedents: Salesforce *record types + page layouts* on one object; Jira
Service Management *request types* (project-admin-owned) mapped onto shared
issue types; ServiceNow's `task` table extension model. All three converged
on "shared base + scoped presentation/field layer", none on
table-per-type.

### 2.4 Generalizing to ERP

In ERP, departments almost never need new *entities* — Item, Vendor,
Invoice, GL Entry are company-wide. What departments own is:

1. **Subtypes/variants** of shared entities (order types, invoice
   categories) — exactly the field-set mechanism above.
2. **Configuration records** (approval matrices, tolerance limits, number
   ranges) — ordinary scoped DocType rows.
3. **Dimension values** (cost centers, profit centers, their own chart
   segments) — scoped master rows.
4. **Row partitions** — "AP sees AP invoices": a scope dimension on
   transactional documents + permission filters (RLS/user-permission
   style), not separate storage.

So the helpdesk model *is* the ERP model: same four ownership kinds, larger
entity count. And master data is the special case where the owning scope is
`global` with stewardship — which is precisely the MDM product (§6): MDM =
global-scope master entities + approval workflow + distribution.

---

## 3. Axis B — Storage & system of record

The organizing questions are only two: **who is the system of record
(SoR)?** and **how do changes propagate?** Every scenario named so far is
one of five storage classes:

| # | Class | Rows live in | SoR | Propagation | DDL rights | Driving case |
|---|---|---|---|---|---|---|
| 1 | **Native** | local PG, table we created | us | none needed | full | everything today |
| 2 | **Adopted** | local PG, pre-existing table | us (maybe shared with CLIs) | none needed | additive-only, opt-in | inherited schemas; MDM plan |
| 3 | **External live** | remote system, no local copy | them | every read/write passes through | none, ever | Railway control plane (XDB spec) |
| 4 | **Mirrored** | local PG **and** remote system | per direction (see below) | sync engine | full locally; none remotely | SAP master data; SaaS sync |
| 5 | **Git-backed** | files in a git repo | the repo | commits/PRs | n/a (commits) | bronze/silver config CSVs |

**The unifying invariant:** a DocType's storage class is invisible above
the storage layer. One `ListView`, one `FormView`, one REST surface, one
permission engine, one hook chain — the DocType definition simply gains a
`storage` descriptor (class + class-specific settings), and the document
engine dispatches reads/writes through a per-class adapter. This is
Frappe's Virtual-DocType idea done declaratively instead of as hand-written
controller code, and it is the single architectural bet that makes all five
classes coherent.

Class-specific requirements worth recording now:

### 3.1 Native (status quo)
Unchanged, except naming policy moves to Axis C (no hardwired `tab_`).

### 3.2 Adopted
Reflection API (Axis C) generates the DocType from `information_schema`;
table keeps its name; augmentation (audit columns) is opt-in and
additive-only. If outside writers (CLIs) also write the table, the
concurrent-writer rules of the XDB spec apply (conflict detection via an
updated-at column where present).

### 3.3 External live
Fully specified in `docs/specs/external-database-doctypes.md` (XDB-1..5).
Slots in here as class 3 unchanged.

### 3.4 Mirrored — the sync engine
Three directional modes, all sharing one engine:

- **Push** (we author → they consume; the SAP MDM case): local DocType is
  native/adopted; each target system gets a *distribution binding*.
  Propagation on lifecycle events (e.g. on approve/submit — not on every
  keystroke) and/or periodic. Requires: an **outbox** (transactional queue
  row per change, rides the existing `tab_background_job`), retry with
  backoff, a dead-letter/error surface, and a per-record sync status
  visible in the UI.
- **Pull** (they author → we mirror for reads/joins; SaaS reference data):
  scheduled import into a local read-only (or steward-editable) copy.
- **Bidirectional** (SaaS master sync): the hard one. Non-negotiable
  concepts from MDM practice (SAP MDG, Informatica): **field-level
  ownership/survivorship** — SoR is decided *per field*, not per record
  ("we own payment terms, the SaaS owns billing e-mail"); conflicts outside
  the ownership map go to a review queue, never silent last-write-wins.
- **Key crosswalk** (all modes): a mapping table `our id ↔ external id per
  target system` (SAP vendor number, SaaS UUID). External systems assign
  their own keys; pretending otherwise is how syncs rot.
- **Reconciliation**: a periodic compare job producing a drift report
  (missing there / missing here / field mismatches), because every sync
  eventually lies.

### 3.5 Git-backed
The requirement is a UI **without losing diffability** — so git stays the
storage *and* the audit log:

- A repo binding (repo, branch, path, format CSV/YAML/JSON) per DocType;
  each row = a record (or one file = one table, per format).
- Reads from a local clone/cache, refreshed by webhook or poll.
- Writes become **commits** authored as the acting user; per-DocType policy:
  direct-commit to branch, or branch + PR (client edits become reviewable
  PRs — agents and humans keep editing the same files, diffs remain the
  history).
- Validation: the DocType's own field/validation metadata gates the UI *and*
  can run in CI on the repo, so agent edits get the same checks.
- Conflicts surface as ordinary git conflicts on the PR, not as framework
  magic. Precedents: Decap CMS, TinaCMS, dbt-style config-as-code.

### 3.6 Storage inside our own Postgres (the non-dimension)

Single schema vs multiple schemas vs multiple databases *within* one
instance turns out not to be a real axis: multiple databases in one PG
instance cannot be joined or share a transaction (reject); multiple schemas
buy naming isolation we don't need once table names are free (Axis C) while
complicating search_path, RLS and FKs. **Default: one database, one schema
(`public`) for all apps and modules**, exactly like Frappe-on-one-site —
with the schema-per-site machinery kept, unused, for the day multi-tenancy
matters.

---

## 4. Axis C — Naming, reflection, augmentation

### 4.1 Physical name belongs in metadata, not in a function

Featherbase currently derives `tab_<name>` in `tableName()`
(`doctype-engine.ts:95`) — same design smell as Frappe's `tab` prefix, and
the direct blocker for adopting existing tables. Decision to ratify:

- Every DocType stores an explicit **`table_name`** in its definition.
- For new native DocTypes it defaults from a configurable policy (plain
  `snake_case` of the name; a prefix is a *policy option*, never a
  requirement).
- For adopted tables it is simply the existing name — verbatim, no rename.
- Logical and physical names are thereby decoupled: renaming a DocType is a
  metadata edit; renaming a column/table is an explicit, tracked migration
  the engine generates (`ALTER TABLE ... RENAME`) — the refactoring story
  Frappe never had and tools like Directus and Prisma Migrate do well.

### 4.2 Reflection API

`introspect(connection?, table)` → proposed DocType: columns→fields with
type mapping, PK detection, nullability→reqd, FKs→Link candidates,
comments→descriptions. Adoption is a *review* step (accept/adjust the
proposal), and the same diff machinery serves later re-sync when the table
drifts (shared requirement with XDB-2).

### 4.3 Augmentation ladder (orthogonal to storage class)

What we add to a table we adopt, strictly opt-in and additive:

- **Level 0 — none**: read/write as-is (mandatory for foreign-owned tables
  — external live class — where we hold no DDL rights).
- **Level 1 — audit**: `created_at`, `created_by`, `updated_at`,
  `updated_by` (enables conflict detection and history).
- **Level 2 — full standard columns**: docstatus/idx/etc., only when the
  table should graduate to a fully framework-managed entity.

DDL rights per storage class (from §3's table) bound which levels are even
offered.

---

## 5. What other platforms teach (independent survey)

- **Directus** — introspection-first "sits on any existing SQL database",
  zero naming conventions, its metadata lives in its own tables beside
  yours. Closest existing product to Axis C; validates dropping the prefix
  entirely.
- **Hasura** — *tracks* existing tables (adoption as an explicit act) and
  keeps all metadata as declarative files in git: metadata itself is
  diffable/reviewable. Worth stealing for Featherbase exports even outside
  the git-backed storage class.
- **NocoDB / Baserow** — Airtable-style UI over existing databases;
  demonstrates the reflection UX (propose, adjust, adopt).
- **Salesforce** — record types + page layouts + field-level security on
  one object, plus *delegated administration*: the reference model for §2.3.
- **Jira Service Management** — request types are portal-facing, per-desk,
  owned by project admins, mapped onto shared issue types: the helpdesk
  case almost verbatim.
- **ServiceNow** — single platform DB, `task` table inheritance
  (incident/change/problem extend one base), scoped applications with
  delegated dev rights: base-entity + scoped extension at enterprise scale.
- **Odoo** — many apps/modules, ONE database; modules *extend shared
  models* (every module adds fields to `res.partner`) rather than owning
  parallel entities: confirms §3.6's one-schema default and §2.4's
  composition-over-duplication.
- **SAP MDG / MDM practice** — staging + approval before distribution,
  field-level survivorship, key mapping per receiving system,
  reconciliation reports: the checklist behind §3.4.
- **dbt / Decap CMS / config-as-code** — UI-over-git with PR gating and CI
  validation; the pattern behind §3.5.

---

## 6. Decisions to ratify (candidate ADRs) and sequencing

**D1.** One database, one schema for all apps/modules; multi-DB-per-instance
rejected; site machinery retained but dormant. (§3.6)

**D2.** `table_name` stored in DocType metadata; prefix becomes a
configurable policy defaulting to none for adopted tables; renames are
generated, tracked migrations. (§4.1)

**D3.** Module is an administrative scope: per-module admin role,
metadata-authoring permission checks, optional row-scope dimension. (§2)

**D4.** Shared-base-entity + scoped Type/field-set registry (no
table-per-type); routing is a field update. (§2.3)

**D5.** DocType definitions carry a `storage` descriptor; five storage
classes behind one adapter interface; the Desk/API/permission/hook surface
is storage-agnostic. (§3)

**D6.** Sync engine primitives: outbox on `tab_background_job`, key
crosswalk table, per-field ownership map for bidirectional mode,
reconciliation job. (§3.4)

### Sequencing against the current plan

The immediate product is **one app — Master Data Management — with multiple
modules, module + app admins, over partly pre-existing tables**:

1. **Now (MDM foundation):** D2 + reflection/adoption + augmentation
   Level 1 (Axis C) — puts the UI over inherited schemas with audit
   columns and no renaming. Then D3 light: module admin role + scoped
   metadata checks.
2. **Now/next (MDM distribution):** D6 push-mode only — outbox, key
   crosswalk, on-approve distribution to SAP/SaaS, sync-status UI,
   reconciliation report. (Defer bidirectional/survivorship until a real
   two-way target exists.)
3. **Next:** git-backed storage class for the medallion config CSVs
   (§3.5) — high client value, self-contained adapter.
4. **Later:** external-live class (XDB spec) for the control plane;
   D4 type/field-set machinery when the helpdesk app is built; multi-app
   packaging; bidirectional sync + survivorship.

Each numbered item should become its own feather-spec before
implementation; this document is the map they hang off.
