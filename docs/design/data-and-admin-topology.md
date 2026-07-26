# Featherbase Data & Administration Topology — Design Framework

> Status: **design framework, v2, 2026-07-26** — follows the research in
> `docs/research/frappe-multi-app-multi-db.md`. v1 organized the
> requirements into three axes; v2 (same day) reworks Axis B after the
> backend-flexibility discussion: apps on Convex or InstantDB, legacy-app
> mirroring (clinical system), and future backends (SQLite, DuckDB, REST,
> files) — plus an evaluation of the proposed rule "a different database
> means a different app". §7 lists decisions to ratify and sequencing.
> Nothing here is implemented; nothing has to land at once.

## 0. The requirements being organized (verbatim intent)

- Helpdesk: Finance and Legal each run a helpdesk on the *same* application
  with *different* ticket types, some shared company-wide; a generic ticket
  is created by someone who doesn't know where it belongs and is routed to
  a department with ~100 specific types. Department admins (create ticket
  types, SLAs) under a company-wide admin. Sub-departments (accounting,
  advance payments, recon) feel like *modules*. Generalize to ERP.
- Storage flexibility, first round: single DB (one schema / several / several
  DBs in one instance) — or the data lives elsewhere: SAP master data
  (author here, sync there, periodically or on every write), SaaS products
  (bidirectional master-data sync), a control plane in Railway Postgres
  (overlay UI, spec: `docs/specs/external-database-doctypes.md`), config
  CSVs in a GitHub repo edited by agents (clients need a UI **without
  losing git diffability**).
- Storage flexibility, second round: some apps on **Convex**, some on
  **InstantDB**; clients with a **legacy app** (a doctor's clinical
  management system — mirror it, adapt on top gradually: doctor + a few
  admins move to our UI while the rest of the team stays on the legacy
  system). Tomorrow a client may insist on a file system, a REST backend,
  SQLite, DuckDB. Candidate simplification to evaluate: *"if it is a
  different database, it has to be a different app."*
- Naming: no forced `tab` prefix — adopt existing tables under their own
  names via a reflection API; optionally add `created_by` / `created_at`
  columns; refactoring (renames) must stay possible.
- Priorities: single app now (an MDM product) with multiple modules,
  module-level admin + app-level admin. Multi-app later. Multi-site /
  multi-tenant is **not** a key requirement.

## 1. Three orthogonal axes

- **Axis A — Organization & delegation.** Who administers what: apps,
  modules, scoped metadata authoring, scoped data visibility.
- **Axis B — Storage.** Decomposed (v2) into three independent parts:
  which **backend driver** stores a DocType's rows, which **ownership
  mode** we hold over that store, and which **sync bindings** connect it to
  other systems.
- **Axis C — Physical naming & augmentation.** Naming policy, reflection,
  opt-in audit columns, refactoring.

Multi-tenancy (PLAT-008 sites) is parked: orthogonal to all three, already
works, not a key requirement.

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

Today `module` is only a sidebar grouping. The upgrade: **module becomes a
first-class scope** with (a) an admin role per module, (b)
metadata-authoring permissions checked against it, and (c) an optional
row-scoping dimension on transactional DocTypes enforced by the permission
layer.

### 2.2 The delegation matrix

| Capability | Platform admin | App admin | Module admin | End user |
|---|---|---|---|---|
| Create/alter any DocType, connections, apps | ✔ | | | |
| App-wide DocTypes, global types, cross-module routing | ✔ | ✔ | | |
| **Types** (field-sets) in own module, SLAs, module roles, assignment rules | ✔ | ✔ | ✔ | |
| Author/act on records per role & scope | ✔ | ✔ | ✔ | ✔ |

Key distinction: a module admin does **not** create free-standing DocTypes
(no new tables); they create *types* of the app's base entities — metadata
that composes onto an existing storage shape. Delegated power never reaches
DDL.

### 2.3 Types: base entity + scoped field-sets (the helpdesk answer)

The generic-ticket-then-routed workflow rules out one-DocType-per-ticket-type
(rows would migrate between tables on routing; 100 types × N departments =
metadata explosion — Frappe's weakness). Instead:

- **One base DocType per domain entity** (`Ticket`) with the common fields
  (subject, requester, status, department, SLA fields).
- **A Type registry DocType** (`Ticket Type`): each row owned by a scope
  (`global` or a module), carrying a *field-set* — extra field definitions,
  conditional layout, SLA/routing defaults, per-type permissions.
- Physically: sparse columns (or a typed `jsonb` section) on the base
  table — the existing Custom Fields machinery (`custom-fields.ts`)
  already adds columns at runtime; this reuses it under module-admin
  control.
- **Routing = updating the type (and department) fields on the same row.**
  Data and history survive; nothing migrates.
- `global`-scoped types are visible everywhere; module-scoped types only
  inside their module. The intake form shows the generic global type.

Precedents: Salesforce record types + page layouts; Jira Service Management
request types (project-admin-owned, mapped onto shared issue types);
ServiceNow's `task` table extension. All converged on "shared base + scoped
field/presentation layer"; none on table-per-type.

### 2.4 Generalizing to ERP

Departments in ERP almost never need new *entities* — Item, Vendor,
Invoice, GL Entry are company-wide. Departments own:

1. **Subtypes/variants** of shared entities (order types) — the field-set
   mechanism above.
2. **Configuration records** (approval matrices, tolerances, number
   ranges) — ordinary scoped rows.
3. **Dimension values** (cost centers, chart segments) — scoped masters.
4. **Row partitions** ("AP sees AP invoices") — a scope dimension +
   permission filters, not separate storage.

So the helpdesk model *is* the ERP model. Master data is the case where the
owning scope is `global` with stewardship — i.e. the MDM product.

---

## 3. Axis B — Storage: driver × ownership × sync bindings

v1 modeled five "storage classes" (native / adopted / external-live /
mirrored / git-backed). The Convex/InstantDB/legacy requirements showed
that conflates three independent choices. v2 decomposes:

```
storage descriptor (per DocType, stored in its definition)
  driver:      postgres | sqlite | duckdb | convex | instantdb |
               rest | git-files | …            ← HOW to talk to the store
  connection:  named connection from the registry (env-var creds)
  mode:        owned | adopted | foreign       ← WHAT RIGHTS we hold
  mapping:     physical table/collection/path, pk column, field map

sync bindings (per DocType, zero or more — a separate object, NOT a mode)
  target:      named connection (any driver)
  direction:   push | pull | bidirectional
  trigger:     on-approve | on-write | schedule
  key crosswalk, field-ownership map, conflict policy
```

v1's classes map onto this cleanly: native = `postgres/owned`; adopted =
`postgres/adopted`; external-live (the Railway XDB spec) = `postgres/
foreign`; git-backed = `git-files/owned-or-adopted`; mirrored = a local
owned/adopted DocType **plus a sync binding** — mirroring stops being a
storage location and becomes a relationship between two stores, which is
what it really is.

**The unifying invariant (unchanged, now sharper):** everything above the
storage layer — ListView, FormView, REST API, permissions, hooks, jobs — is
storage-agnostic. The document engine dispatches through a **storage
adapter interface** per driver. This is Frappe's Virtual DocType idea made
declarative, and it is the load-bearing architectural bet.

### 3.1 The adapter interface and the capability matrix

One interface, roughly: `getList(filters, sort, page)`, `getDoc(pk)`,
`insert`, `update`, `delete`, `count`, plus optional `introspect()`
(reflection), `transact()` (atomic multi-write), `subscribe()` (realtime).

Drivers are not equal, and pretending they are is how frameworks rot. Each
driver **declares capabilities**, and the engine degrades features
explicitly (greyed-out, not broken) — the same design as Hasura's NDC
connector spec (a capabilities endpoint negotiates what each source
supports; pushdown where possible) and Trino's connector SPI:

| Capability | postgres | sqlite/duckdb | convex | instantdb | rest | git-files |
|---|---|---|---|---|---|---|
| Filter/sort/page pushdown | ✔ | ✔ | ✔ (indexes) | ✔ (InstaQL) | endpoint-dependent | in-memory |
| Transactions (multi-row lifecycle) | ✔ | ✔ | ✔ (mutations) | ✔ | ✗ (usually) | per-commit |
| DDL / schema change by us | ✔ | ✔ | schema-in-code | schema push | ✗ | file format |
| Reflection (`introspect`) | ✔ (info_schema) | ✔ | ✔ (schema export) | ✔ (schema) | OpenAPI, best-effort | header/sample |
| Realtime subscriptions | via our WS layer | ✗ | ✔ native | ✔ native | ✗ | webhook |
| RLS enforcement in-store | ✔ | ✗ | ✗ (server fns) | permissions lang | ✗ | ✗ |

Notes for the named backends:

- **Convex** — a reactive transactional document store; all access goes
  through TypeScript queries/mutations. A driver wraps the Convex client
  SDK; its native reactivity can feed our websocket layer directly, making
  Convex-backed DocTypes *more* live than Postgres ones. Schema lives in
  code (`defineSchema`), so "DDL" means generating/pushing that file —
  owned mode is possible but different in kind.
- **InstantDB** — client-first sync DB (triple store over Postgres,
  InstaQL relational queries, offline + optimistic updates). Same story:
  driver wraps the SDK/Admin API, realtime is native, schema is pushable.
- **Legacy app DB** (clinical system) — usually just `postgres`/`mysql`
  driver in `foreign` mode against the legacy database, or `rest` against
  its API — plus sync bindings (§3.3). The legacy *app* keeps running;
  we are only another client.
- **rest** — the fully general fallback (covers SaaS without DB access).
  Capabilities are per-endpoint; expect in-memory filtering caps and no
  transactions.
- **sqlite / duckdb** — embedded analytical/local files; near-postgres
  capabilities minus RLS and concurrent writers; DuckDB notably good for
  read-heavy analytical DocTypes over parquet/CSV.

**Degradation rules the engine must enforce (not per-driver, global):**

- Lifecycle transactionality is guaranteed only within one backend; a save
  touching an external backend plus local rows (audit, jobs) is two
  commits, surfaced honestly in the sync/log status.
- **Cross-backend Link fields are reference-only**: store the foreign key,
  resolve the title on read, no joins, no cascade, no `EXISTS` filters.
  Full link features (join-powered list columns, cascading rename) require
  both DocTypes on the same connection.
- Naming series, permission checks, and hooks always run on the core
  (Postgres) side regardless of the target backend — counters and
  authorization never delegate to a foreign store.
- Postgres RLS applies only to local tables; for every other driver the
  server-side permission gate is the sole enforcement (same rule as the
  XDB spec's P2).

### 3.2 Ownership modes

- **owned** — we created the store/table, full rights, framework manages
  schema (per driver's notion of schema).
- **adopted** — pre-existing store we now administer: reflect first
  (Axis C), keep names verbatim, additive-only augmentation, outside
  writers tolerated (conflict detection via updated-at where available).
- **foreign** — someone else's system of record: pass-through reads/writes,
  **never any DDL**, reflection read-only, degrade per capability matrix.
  (The Railway control plane; the clinical system's DB; any SaaS API.)

### 3.3 Sync bindings — the engine for mirrored data

One engine, three directional modes:

- **Push** (we author → they consume; SAP master data): triggered on
  lifecycle events (typically on-approve/submit, not every keystroke)
  and/or schedule. Requires an **outbox** (transactional queue row per
  change, riding `tab_background_job`), retry with backoff, a
  dead-letter/error surface, per-record sync status in the UI.
- **Pull** (they author → we mirror for reads/joins; SaaS reference data):
  scheduled or webhook-driven import into a local copy.
- **Bidirectional** (SaaS master sync; legacy coexistence): requires a
  **field-ownership/survivorship map** — system of record decided *per
  field*, not per record ("we own payment terms, the SaaS owns billing
  e-mail"); conflicts outside the map go to a review queue, never silent
  last-write-wins.
- **Key crosswalk** (all modes): `our id ↔ external id` per target system.
  External systems assign their own keys; pretending otherwise is how
  syncs rot.
- **Reconciliation** (all modes): periodic compare producing a drift report
  (missing here/there, field mismatches), because every sync eventually
  lies.

#### The legacy-coexistence pattern (the doctor's clinical system)

This is the **strangler-fig migration** made operational, and the
field-ownership map is the migration *dial*:

1. **Mirror** — pull binding from the legacy DB/API into a local adopted
   copy; our UI is read-only. Zero risk; the doctor sees everything in the
   new UI on day one.
2. **Co-write** — flip ownership of specific fields/DocTypes to us
   (appointments notes? new custom fields that don't exist in the legacy
   system at all?); bidirectional binding keeps the legacy UI truthful for
   the rest of the team. Conflict queue guards the overlap.
3. **Extend** — new capabilities (new DocTypes, workflows, reports) are
   born native on our side, linked to mirrored entities; the legacy system
   never sees them.
4. **Retire** — ownership map ends up fully ours; the pull binding becomes
   an archive; the legacy system is switched off. No big-bang cutover at
   any step, and each step is a config change, not a build.

### 3.4 git-files driver — UI without losing diffability

- Repo binding per DocType: repo, branch, path, format (CSV/YAML/JSON);
  row = record.
- Reads from a local clone/cache refreshed by webhook or poll.
- Writes become **commits authored as the acting user**; per-DocType
  policy: direct commit, or branch + PR (client edits arrive as reviewable
  PRs; agents keep editing the same files; the diff *is* the history).
- The DocType's validation metadata gates the UI **and** can run in CI on
  the repo, so agent edits get the same checks.
- Conflicts surface as ordinary git conflicts on the PR — no framework
  magic. Precedents: Decap/Tina CMS, dbt-style config-as-code.

### 3.5 Storage inside our own Postgres (the non-dimension)

Multiple databases in one PG instance cannot be joined or share a
transaction — reject. Multiple schemas buy naming isolation we don't need
once table names are free (Axis C). **Default: one database, one schema for
all apps and modules**, with the schema-per-site machinery kept dormant for
the day multi-tenancy matters.

---

## 4. Axis C — Naming, reflection, augmentation

### 4.1 Physical name belongs in metadata, not in a function

`tableName()` currently derives `tab_<name>` (`doctype-engine.ts:95`) —
the same design smell as Frappe's prefix, and the direct blocker for
adoption. To ratify:

- Every DocType stores an explicit **`table_name`** (or
  collection/path — the mapping half of the storage descriptor).
- New owned DocTypes default from a configurable policy (plain
  `snake_case`; a prefix is a policy *option*, never a requirement).
- Adopted stores keep their names verbatim.
- Logical and physical names decouple: renaming a DocType is a metadata
  edit; renaming a column/table is an explicit, tracked migration the
  engine generates — the refactoring story Frappe never had and Directus /
  Prisma Migrate do well.

### 4.2 Reflection API — a driver capability

`introspect(connection, target)` → proposed DocType: columns→fields with
type mapping, PK detection, nullability→reqd, FKs→Link candidates.
Adoption is a *review* step (accept/adjust), and the same diff machinery
serves later drift re-sync (shared with XDB-2). Each driver implements
`introspect` per its catalog: `information_schema`, Convex/Instant schema
exports, OpenAPI for REST (best-effort), header/sample inference for
files — Airbyte's "catalog discovery" is the precedent for
reflection-across-heterogeneous-sources.

### 4.3 Augmentation ladder (opt-in, additive, bounded by mode)

- **Level 0 — none**: as-is (the only option in `foreign` mode).
- **Level 1 — audit**: `created_at/by`, `updated_at/by` (enables conflict
  detection and history).
- **Level 2 — full standard columns**: only when a table graduates to a
  fully framework-managed entity.

---

## 5. "A different database must be a different app" — evaluation

The proposed simplification is *almost* right. Where it holds and where it
breaks:

**What it gets right.** An app is the natural unit of packaging and
operations: one backend per app means one connection to configure, one
failure domain (backend down → one app degraded, Desk fine — XDB S1
generalized), one backup story, full-featured Links *within* the app, and
an install manifest that can declare its driver dependency. It also matches
reality: a Convex app's DocTypes will practically all live in that Convex
deployment.

**Where a hard rule breaks, on this document's own use cases:**

1. **Core doctypes are always local.** Users, roles, permissions, files,
   jobs, audit live on core Postgres; every app links to them. So "one
   backend per app" can never mean full isolation — it can only govern the
   app's *own* DocTypes.
2. **The strangler pattern violates it by design** (§3.3): the clinical
   app holds mirrored-adopted local DocTypes *and* new native DocTypes
   *and* (early on) maybe a foreign passthrough — one app, one client
   journey, multiple storage positions that *change over time*. Forcing an
   app split per phase would be absurd.
3. **Sync bindings blur it anyway**: an MDM app whose rows are local but
   bound to SAP + two SaaS targets is already talking to four backends.

**Resolution — policy, not constraint:**

- **D9a.** The storage descriptor stays **per-DocType** (the framework
  never structurally forbids mixing), because the migration/coexistence
  cases demand it.
- **D9b.** "One *primary* backend per app" is the **strongly-recommended
  default**: the app manifest declares a default connection; a DocType
  deviating from it is a deliberate, flagged exception (lint/warning +
  visible in the app's storage summary), not a silent choice.
- **D9c.** The hard rules that actually protect users are the degradation
  rules of §3.1: cross-backend links reference-only; transactions never
  span backends; permissions/series/hooks always evaluated on core.

---

## 6. What other platforms teach (independent survey)

- **Hasura NDC / DDN** — connectors are services conforming to a spec with
  a **capabilities endpoint**; the engine negotiates and pushes down what
  each source supports. The direct model for §3.1.
- **Trino/Presto** — federated connectors with per-connector pushdown;
  proof that "one query surface, many unequal backends" works at scale.
- **Ecto adapters / Django DB backends** — ORM-level adapter seams with
  capability flags and a shared conformance test suite; the packaging
  model for our drivers (npm packages + conformance tests).
- **Airbyte/Singer** — connector catalogs + discovery; the precedent for
  reflection and for the pull half of sync bindings.
- **Directus** — introspection-first over any existing SQL DB, zero naming
  conventions, metadata beside your tables. Validates Axis C.
- **Hasura metadata-as-code** — declarative, git-diffable metadata; worth
  stealing for Featherbase definition exports regardless of storage.
- **NocoDB / Baserow** — the reflection UX (propose → adjust → adopt).
- **Salesforce / JSM / ServiceNow** — record types, request types, task
  inheritance + delegated administration: the references for §2.
- **Odoo** — many modules, ONE database, modules extend shared models;
  confirms §3.5 and §2.4.
- **SAP MDG / MDM practice** — staging + approval before distribution,
  field-level survivorship, key mapping per receiving system,
  reconciliation: the checklist behind §3.3.
- **Strangler fig (Fowler)** — the named pattern behind the legacy
  coexistence plan; our contribution is making the field-ownership map the
  incremental dial.
- **Convex / InstantDB** — both are JS/TS-native with pushable schemas and
  native realtime, so drivers wrap official SDKs and can make those
  DocTypes *more* reactive than local ones, not less.
- **Decap CMS / dbt** — UI-over-git with PR gating and CI validation
  (§3.4).

---

## 7. Decisions to ratify (candidate ADRs) and sequencing

**D1.** One database, one schema for all apps/modules on the core backend;
multi-DB-per-instance rejected; site machinery retained, dormant. (§3.5)

**D2.** Physical name (`table_name`/collection/path) stored in DocType
metadata; prefix a configurable policy defaulting to none for adopted
stores; renames are generated, tracked migrations. (§4.1)

**D3.** Module is an administrative scope: per-module admin role,
metadata-authoring checks, optional row-scope dimension. (§2)

**D4.** Shared-base-entity + scoped Type/field-set registry; routing is a
field update, never a row migration. (§2.3)

**D5.** Storage descriptor per DocType = driver + connection + mode +
mapping, behind one adapter interface with **declared capabilities** and
explicit degradation; Desk/API/permissions/hooks are storage-agnostic.
(§3, §3.1)

**D6.** Sync bindings are first-class objects separate from storage:
outbox on `tab_background_job`, key crosswalk, field-ownership map,
conflict review queue, reconciliation job. (§3.3)

**D7.** Ship the adapter *seam* first, drivers later: implement only
`postgres` (owned/adopted/foreign) initially, but define the interface,
capability declaration, and a **driver conformance test suite** now, so
every future driver (sqlite, duckdb, convex, instantdb, rest, git-files)
is a plugin passing a known suite — not a framework surgery. (§3.1)

**D8.** Degradation rules are engine-level law: cross-backend links
reference-only; lifecycle transactions within one backend only;
permissions, naming series, and hooks always evaluated on core. (§3.1)

**D9.** One *primary* backend per app as flagged default; per-DocType
deviation allowed but deliberate. (§5)

### Sequencing against the current plan

The immediate product is **one app — Master Data Management — with
modules, module + app admins, over partly pre-existing Postgres tables**:

1. **Now (MDM foundation):** D2 + D5's *descriptor and seam* (postgres
   driver only, D7) + reflection/adoption + augmentation Level 1 — the UI
   over inherited schemas, audit columns, no renaming. Then D3 light:
   module admin role + scoped metadata checks.
2. **Now/next (MDM distribution):** D6 push mode — outbox, crosswalk,
   on-approve distribution to SAP/SaaS, sync-status UI, reconciliation.
   Defer bidirectional/survivorship until a real two-way target exists.
3. **Next:** git-files driver for the medallion config CSVs (§3.4) —
   self-contained, high client value, and the first proof that the D7 seam
   holds for a non-SQL backend.
4. **Later:** foreign-mode passthrough hardening (the XDB spec) for the
   control plane; the legacy/clinical strangler engagement (pull binding →
   ownership dial); convex/instantdb drivers when a real app lands on
   them; D4 type machinery with the helpdesk app; bidirectional sync.

Each numbered item becomes its own feather-spec; this document is the map
they hang off.
