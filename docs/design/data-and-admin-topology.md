# Featherbase Data & Administration Topology — Design Framework

> Status: **design framework, v3, 2026-07-26** — follows the research in
> `docs/research/frappe-multi-app-multi-db.md`. v1 organized the
> requirements into three axes; v2 (same day) reworked Axis B after the
> backend-flexibility discussion (Convex/InstantDB apps, legacy-app
> mirroring, future backends, "a different database means a different
> app"); v3 (same day) adds **Axis D — extensibility & distribution**: a
> WordPress/VS Code/Salesforce-grade plugin ecosystem with micro/macro
> composability, grounded in a survey of NocoBase, Directus, Medusa,
> Strapi/Payload, and Salesforce 2GP packaging. v4 (same day) answers "is
> there any other axis?" with three: **E — time** (versioning, audit,
> effectivity), **F — change lifecycle** (environments & metadata
> promotion), **G — actors & identity** (humans, portals, machines, AI
> agents) — and names the cross-cutting concerns that are deliberately
> *not* axes. §9 lists decisions to ratify and sequencing. Nothing here is
> implemented; nothing has to land at once.
>
> Related: [ADR 0007](../adr/0007-app-and-database-topology.md) and specs
> `0001-external-data-sources.md` / `0002-virtual-doctypes.md` (merged from
> a parallel session) implement the `postgres/foreign` slice of Axis B and
> the custom-controller fallback.

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
  (overlay UI — now specced as `docs/specs/0001-external-data-sources.md`
  under [ADR 0007](../adr/0007-app-and-database-topology.md)), config
  CSVs in a GitHub repo edited by agents (clients need a UI **without
  losing git diffability**).
- Storage flexibility, second round: some apps on **Convex**, some on
  **InstantDB**; clients with a **legacy app** (a doctor's clinical
  management system — mirror it, adapt on top gradually: doctor + a few
  admins move to our UI while the rest of the team stays on the legacy
  system). Tomorrow a client may insist on a file system, a REST backend,
  SQLite, DuckDB. Candidate simplification to evaluate: *"if it is a
  different database, it has to be a different app."*
- Extensibility, third round: **Salesforce's design is admired.** Wanted: a
  WordPress-style contribution loop (someone contributes a plugin or fixes
  a bug and it becomes available to everybody) and VS Code-style
  extensions — contributing tables, workflows, definitions, even UI
  elements. Plus **micro-apps**: unlike VS Code extensions (all-or-nothing),
  it should be possible to take *only certain parts* of a larger app —
  "micro modules or macro modules from which people can pick". Research
  leading open-source platforms (Strapi-class headless CMS and similar).
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
- **Axis D — Extensibility & distribution (v3).** How functionality is
  packaged, contributed, composed, and upgraded: contribution points,
  micro/macro granularity, upgrade-safe customization, trust tiers.
- **Axis E — Time (v4).** How *data* changes over time and how the past is
  seen: versioning, audit trail, effectivity dating, as-of reads.
- **Axis F — Change lifecycle (v4).** How *metadata/config* change moves
  safely: environments, promotion, preview/diff, rollback.
- **Axis G — Actors & identity (v4).** Who or what is acting — internal
  humans, portal users, machines, AI agents — and how identity propagates
  across storage backends and sync boundaries.

Each axis answers one question: A *who administers what*; B *where data
lives and who owns it*; C *what we impose on physical stores*; D *how
functionality arrives and evolves*; E *how data moves through time*; F
*how metadata moves through environments*; G *who is acting*. E and F are
deliberate mirrors: E is time for data, F is time for definitions.

Multi-tenancy (PLAT-008 sites) is parked: orthogonal to all seven, already
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
`postgres/adopted`; external-live (the Railway case) = `postgres/foreign`
— specced in detail as `docs/specs/0001-external-data-sources.md` under
[ADR 0007](../adr/0007-app-and-database-topology.md); git-backed =
`git-files/owned-or-adopted`; mirrored = a local owned/adopted DocType
**plus a sync binding** — mirroring stops being a storage location and
becomes a relationship between two stores, which is what it really is.
Spec 0002 (Virtual DocTypes) slots in as the app-supplied custom driver:
a controller implementing the adapter protocol for a one-off source, the
escape hatch until (or instead of) a first-class driver exists.

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
  server-side permission gate is the sole enforcement (stated as a
  consequence in ADR 0007).

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
serves later drift re-sync (shared with spec 0001's introspection and
drift-detection groups). Each driver implements
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
failure domain (backend down → one app degraded, Desk fine — spec 0001's
failure semantics generalized), one backup story, full-featured Links *within* the app, and
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

## 6. Axis D — Extensibility & distribution (the plugin ecosystem)

The 25-year wish list distilled: Salesforce's *platform* qualities, with
WordPress's *contribution loop* (a stranger fixes a bug, everyone gets it),
VS Code's *extension mechanics*, and one thing none of them offer —
**taking only parts of a bigger app**.

### 6.1 Microkernel stance: everything is a plugin

The systems whose ecosystems actually thrived (VS Code, WordPress, Eclipse
— and in this product category, **NocoBase**, whose core does only plugin
lifecycle/dependency management while every feature, including its data
sources and workflow engine, is a plugin) share one discipline: **the
platform's own features use the same public extension API that third
parties use.** The moment core features get private APIs, the public one
rots.

For Featherbase: the core is the metadata engine, document engine,
permission engine, storage-adapter seam (D5/D7), and the Desk shell with
its extension points. Workflow, print, comments, email — and every future
app (helpdesk, MDM) — are plugins over that API. The existing
`AppManifest` (PLAT-001: doctypes, doc_events, scheduler_events, method
overrides) is the seed to grow, not replace.

### 6.2 Typed contribution points

VS Code's key invention is that an extension *declares* what it
contributes, statically, in its manifest — the platform can render menus,
marketplaces, and permission prompts without executing the code, and can
activate lazily. Directus proves the same taxonomy works for a
metadata-driven admin UI (its nine extension types: interfaces, displays,
layouts, modules, panels, hooks, endpoints, operations, bundles).

Featherbase contribution points (initial enumeration):

| Contribution | Kind | Precedent |
|---|---|---|
| DocTypes, field-sets/types, seeds | metadata | Frappe app doctypes |
| Fieldtypes: form widget + display + cell renderer | UI | Directus interfaces/displays |
| List layouts / views (kanban, calendar, map) | UI | Directus layouts |
| Pages / Desk modules, dashboard panels | UI | Directus modules/panels |
| Workflow node & trigger types | logic | Directus operations, n8n nodes |
| Lifecycle hooks, scheduled jobs | logic | existing doc_events |
| API endpoints / RPC methods | logic | existing overrides |
| Storage drivers, sync connectors | platform | D7; Hasura NDC |
| Roles/permission templates, reports, print formats | metadata | Frappe fixtures |

Metadata contributions are declarative JSON — reviewable, diffable,
installable without running code. Code contributions (widgets, hooks,
drivers) ride the trust tiers of §6.5. Server + client halves ship in one
package (the Strapi/NocoBase pattern).

### 6.3 Package ≠ capability: micro/macro composability

The "I can't take just a part of a VS Code extension" complaint is a real
design gap in every ecosystem above, and the fix is to split two concepts
those systems fuse:

- **Package** — the distribution unit (an npm package; how code/metadata
  travels, is versioned, and gets bug fixes).
- **Capability** — the enableable unit: a named group of contributions
  *inside* a package, with its own dependency list.

A macro package ("Helpdesk") exposes capabilities — ticket base +
types, SLA engine, assignment rules, portal — each installable/enableable
separately, with dependencies declared **capability-to-capability** (SLA
requires ticket base; it does not require the portal). A micro package may
be a single widget. Installing a package enables a chosen subset, not
everything. Precedents: **Medusa's commerce modules** (cart, inventory,
pricing usable standalone — the closest existing realization), Odoo's
`depends`/`auto_install` graph at module level; anti-precedent: VS Code's
all-or-nothing extensions — the user's criticism is correct.

This also resolves terminology across the axes: **"app" and "platform
extension" are roles of the same package format** (as in Frappe, where
everything is an app, and NocoBase, where everything is a plugin). Axis A's
*module* (admin delegation scope) is untouched — a package can *contribute*
modules, but module ≠ package.

### 6.4 Upgrade-safe customization: the Salesforce lesson

The single best idea in the user's favorite design: in a Salesforce
subscriber org, **managed-package metadata is not editable — it is
extendable**, per-component manageability rules decide what the subscriber
may touch, and package upgrades therefore never collide with
customizations. Frappe approximates this with Custom Field / Property
Setter overlays; ADR 0003 already gave Featherbase the two-source model
(`source: package | site`, drift detection, byte-identical promotion
round-trip). Axis D generalizes it to a **layer stack**:

```
package layers (one per installed package, versioned, read-only on site)
  └─ site overlay (custom fields, property setters, layout/permission
     overrides — created via UI, owned by the site)
        └─ effective metadata (deterministic merge, cached)
```

Rules: a package upgrade replaces only its own layer; the site overlay
survives by construction; conflicts (package now ships a field the site
had customized) are detected at upgrade time and resolved explicitly, not
silently. **This is what makes the WordPress loop safe**: the bug fix
reaches every site because updating a package cannot stomp what sites
built on top of it.

### 6.5 Trust & isolation tiers

- **Tier 1 — reviewed packages** (npm, in-process): full API. WordPress's
  low contribution barrier, but gated by the conformance suites (D7
  generalized: one suite per contribution type) and, when a marketplace
  exists, a review step — Salesforce's AppExchange security review is the
  model.
- **Tier 2 — site scripts** (already exist: server-scripts.ts): sandboxed,
  site-authored, no package needed — the escape hatch that keeps tier 1
  honest.
- **Tier 3 — out-of-process services**: storage drivers/sync connectors
  may run as separate services speaking the adapter protocol (Hasura NDC
  shape) where isolation or another language matters.

UI contributions prefer **declarative schema over arbitrary JS** (render
from metadata where possible — NocoBase's UI-schema approach); a
full-code widget is a tier-1 contribution by definition.

---

## 7. The axes v1–v3 missed (v4)

### 7.1 Axis E — Time: versioning, audit, effectivity

Every requirement in this document quietly assumes it: the MDM product,
the clinical data, the git CSVs, bidirectional sync. Made explicit:

- **Audit trail** — who changed what, when, through which surface. The
  clinical case makes this regulatory, not optional; Axis G decides *who*
  gets recorded.
- **Version history** — per-document diffs (Frappe's Version doctype is
  the floor), restore, and the rule that history is append-only.
- **Effectivity dating** — the MDM requirement hiding in plain sight:
  master data changes *take effect on a date* (a price, a payment term, an
  org assignment — SAP master data is effective-dated everywhere).
  `valid_from`/`valid_to` as a first-class field pattern with overlap
  validation, not something every app reinvents.
- **As-of reads** — "the vendor record as it stood on March 1", for
  reports and for sync reconciliation. Bitemporal (valid time vs recorded
  time — SQL:2011 temporal tables, XTDB) is the full model; v1 can ship
  effectivity + version history and leave true bitemporal queries later.
- Storage-class interactions: the git-files driver gets history *free*
  (the log is the history); DB drivers need version rows; sync bindings
  need replay ("re-send everything since T") — one time model serves all
  three.

### 7.2 Axis F — Change lifecycle: environments & metadata promotion

Axis E's mirror, for definitions instead of data. The Salesforce quality
that isn't packaging: **sandboxes and staged deployment**. Frappe's known
weakness (ADR 0003 records its export machinery as "buggy and
unreliable") is exactly here.

- **Environments** — a metadata change (new field, new type, new SLA) is
  authored somewhere safe, then *promoted* dev → test → prod; ADR 0003's
  `package | site` sources and byte-identical promotion round-trip are the
  foundation; D13's layer stack is the unit that moves.
- **Plan before apply** — every promotion shows its diff (metadata *and*
  the DDL it implies) before touching prod — terraform-plan for DocTypes;
  the same diff UI Axis C's reflection re-sync already needs.
- **Rollback** — a promoted layer version can be stepped back; data
  migrations that can't roll back must say so at plan time.
- Scope note: module admins creating types in prod (Axis A) is *allowed*
  by design — governed, low-risk metadata; Axis F is for changes that
  carry code, DDL, or cross-module impact. The boundary between
  "config change, safe live" and "release, goes through promotion" must
  be explicit per contribution type.

### 7.3 Axis G — Actors & identity

Four kinds of principal act on the system, and v1–v3 only modeled the
first:

1. **Internal humans** — Desk users; roles/scopes (Axis A).
2. **External humans** — portal users: the UN requester filing a ticket,
   a client reviewing a config PR. Same permission engine, narrower
   surface; never counted against internal seats.
3. **Machines** — the CLIs writing the control schema, SAP, SaaS webhooks:
   service accounts with API keys, so external writes are *attributed*,
   rate-limited, and permission-checked like everyone else.
4. **AI agents** — already real here (the medallion CSVs are agent-edited;
   ADR 0003's authoring loop is agent-first). Agents are principals with
   their own identity **plus an on-behalf-of chain** ("agent X acting for
   the doctor"), so audit (Axis E) never collapses the two.

The hard requirement is **identity propagation across boundaries**: a Desk
edit that becomes a git commit carries the acting user as author; a sync
push to SAP carries a mapped SAP user; an agent's write is recorded as
agent-for-user. Every storage driver and sync binding declares how it
represents identity — part of the adapter contract (D5), not an
afterthought.

### 7.4 Cross-cutting concerns that are deliberately *not* axes

- **Observability** (sync health, job monitoring, drift reports) — a
  quality bar inside each engine, not a dimension of the design space.
- **Compliance/governance** (retention, PII handling, residency) —
  policies *expressed with* E (history), G (actors), and B (where data
  lives); adding an axis would duplicate those three.
- **Presentation surfaces** (Desk / portal / embed) — follows from Axis G
  personas plus app UI; not independent.
- **i18n** — exists (`i18n.ts`); a feature, not a dimension.
- **Offline** — a driver capability (InstantDB has it natively), already
  expressible in the D5 capability matrix.
- **Performance/scale** — engineering discipline everywhere, dimension
  nowhere.

---

## 8. What other platforms teach (independent survey)

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
- **NocoBase** — the closest existing system to this document's target:
  microkernel where the core does only plugin lifecycle/dependency
  management; data sources, workflow, and UI blocks are all plugins with
  server+client halves; UI is schema-rendered. A standing study target.
- **Directus** — introspection-first over any existing SQL DB, zero naming
  conventions, metadata beside your tables (validates Axis C) — and a
  clean nine-type extension taxonomy (interfaces, displays, layouts,
  modules, panels, hooks, endpoints, operations, bundles) that maps almost
  one-to-one onto §6.2's contribution points.
- **Salesforce packaging (2GP)** — managed packages with per-component
  manageability rules, dependency-aware versioned upgrades, push upgrades,
  AppExchange security review: the reference for §6.4/§6.5.
- **Medusa** — commerce capabilities as independently usable modules; the
  proof that "take only parts of a macro app" (§6.3) is achievable.
- **Strapi / Payload** — plugin marketplaces for headless CMS; Strapi's
  server+admin plugin packaging; Payload's plugins-as-config-transformers
  (a plugin is a function over the site config — an elegantly composable
  model worth remembering for metadata-layer merging).
- **WordPress** — the contribution loop itself: trivially low barrier,
  update channel, bug fix reaches everyone. Its failure (no isolation, no
  manageability rules, plugin conflicts) is exactly what §6.4/§6.5 guard
  against.
- **VS Code** — statically declared contribution points + lazy activation
  + marketplace + auto-update; anti-precedent for granularity (§6.3).
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

## 9. Decisions to ratify (candidate ADRs) and sequencing

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

**D10.** Microkernel/dogfooding rule: platform features and first-party
apps are plugins over the same public contribution API — no private core
APIs for features. (§6.1)

**D11.** Typed contribution points, statically declared in the package
manifest (metadata contributions as declarative JSON), lazily activated;
`AppManifest` evolves into this rather than being replaced. (§6.2)

**D12.** Package (distribution unit) ≠ capability (enableable unit):
capabilities carry their own dependency graph; installing a package
enables a chosen subset — micro/macro composability. (§6.3)

**D13.** Layered metadata: per-package read-only layers + a site overlay,
deterministic merge, upgrade replaces only the package's own layer,
conflicts surfaced at upgrade time. Extends ADR 0003's
`source: package | site` to N package layers. (§6.4)

**D14.** Trust tiers: reviewed in-process packages / sandboxed site
scripts / out-of-process driver services; UI contributions prefer
declarative schema over arbitrary code. (§6.5)

**D15.** Distribution rides npm with semver; each contribution type gets a
conformance test suite (generalizing D7); marketplace/registry is a later
layer on top, not a prerequisite. (§6)

**D16.** Time is first-class: append-only version history + audit trail on
every mutation, and effectivity dating (`valid_from`/`valid_to` with
overlap validation) as a standard field pattern; full bitemporal queries
deferred. (§7.1)

**D17.** Metadata changes promote through environments with plan-preview
(metadata + implied DDL) and layer-version rollback, building on ADR
0003's promotion round-trip and D13's layers; per contribution type, the
"safe live in prod" vs "goes through promotion" boundary is declared
explicitly. (§7.2)

**D18.** Four principal kinds (internal, portal, machine, agent) share one
permission engine; agents carry an on-behalf-of chain; every driver and
sync binding declares its identity-propagation mapping as part of the
adapter contract. (§7.3)

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
4. **Later:** foreign-mode passthrough (ADR 0007 + specs 0001/0002) for
   the control plane; the legacy/clinical strangler engagement (pull binding →
   ownership dial); convex/instantdb drivers when a real app lands on
   them; D4 type machinery with the helpdesk app; bidirectional sync.

v4 additions to the "now" bucket: the MDM app needs **D16's audit +
version history from day one** (master data without an audit trail is not
master data) and should model effectivity dating in its first entities;
D17 and D18 (beyond the existing user/role model + attributing CLI writes
via service-account convention) can follow.

Axis D's cheap-now part: D10 and D11 are *disciplines*, not features —
every feature built from here on (including the MDM app itself) goes
through the manifest/contribution API, which is how the API becomes real
before any marketplace exists. D13's layer stack should be designed
together with D2 (both touch how definitions are stored). D12's
capability granularity, D14's tier 3, and D15's marketplace are genuinely
later.

Each numbered item becomes its own feather-spec; this document is the map
they hang off.
