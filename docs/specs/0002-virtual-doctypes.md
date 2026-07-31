# Feature: Virtual DocTypes — controller-supplied storage

Status: **Proposed** — not implemented. Written 2026-07-26.
Decision record: `docs/adr/0007-app-and-database-topology.md`.
Background: `docs/research/frappe-multi-app-and-multi-db.md` (Frappe's
`frappe/model/virtual_doctype.py` protocol).

## Workflow Context

`docs/specs/0001-external-data-sources.md` covers the common case: the foreign
data is a Postgres table, so Featherbase can generate SQL against it and keep
filters, sorting, pagination and counting. That leaves everything that is *not*
a Postgres table — a REST API, a queue's admin endpoint, a CLI's JSON state
file, a warehouse behind an HTTP query service.

Frappe's answer is the Virtual DocType: a DocType with no table, whose
controller implements the storage protocol. It is the right shape to copy,
because it is the only escape hatch an app author needs to learn.

## Goal

Let an app back a DocType with an arbitrary store by implementing a small,
enforced protocol, and get the resource API, permissions and generic Desk for
free.

## Scope

**In:** an `is_virtual` DocType flag; a controller protocol enforced at
registration; routing of read, write and delete through the controller;
permission and Desk parity; explicit, enumerated limitations.

**Out:** SQL pushdown of any kind (the controller owns filtering); child-table
persistence; link-integrity protection over virtual data; report builder over
virtual DocTypes; Postgres sources (use spec 0001 — richer and cheaper).

## Dependencies

- **Requires:** controller registry (DOC-004), document engine (DOC-001…011),
  permissions (PERM-*), app system (PLAT-001).
- **Blocked by:** nothing. Independent of spec 0001; either may ship first.

---

## VDT-1: Declare a virtual DocType

- WHEN a DocType is saved with `is_virtual` set, THE SYSTEM SHALL create no
  table, emit no DDL, generate no RLS policy, and skip it in the migration
  runner.
- WHEN a virtual DocType is saved without a registered controller, THE SYSTEM
  SHALL reject the save naming the missing controller.
- THE SYSTEM SHALL still store the DocType and its fields in the control DB, so
  metadata, permissions and the generic Desk work unchanged.

**Examples:**

| Input | Result |
|---|---|
| DocType `Deploy Log`, `is_virtual`, controller registered | Saved; no `tab_deploy_log`; appears in the Desk sidebar |
| DocType `Deploy Log`, `is_virtual`, no controller | Rejected: "No virtual controller registered for Deploy Log" |

## VDT-2: The controller protocol

- THE SYSTEM SHALL require a virtual controller to implement `load(name)`,
  `insert(doc)`, `update(doc)`, `remove(name)`, `list(args)` and `count(args)`.
- WHEN a controller is registered, THE SYSTEM SHALL validate that all six are
  present and are functions, and SHALL refuse the registration otherwise —
  mirroring Frappe's `validate_controller()`, which is the difference between a
  clear boot error and a 500 on first use.
- THE SYSTEM SHALL pass `list` and `count` the same argument shape the query
  layer builds (filters, fields, order_by, limit, offset) and SHALL accept the
  returned rows as-is.
- THE SYSTEM SHALL type the protocol in `packages/shared` so controllers are
  checked at compile time as well as at registration.

**Examples:**

| Input | Result |
|---|---|
| Controller with 6 methods | Registered |
| Controller missing `count` | Registration throws at boot: "Deploy Log: virtual controller missing count()" |
| `list({filters:[["status","=","failed"]], limit:20})` | Controller returns ≤20 rows; the framework does not re-filter |

## VDT-3: Reading and writing through the controller

- WHEN a client calls `get_doc`, `get_list` or a count on a virtual DocType, THE
  SYSTEM SHALL apply permissions first and then delegate to the controller.
- WHEN a client saves, THE SYSTEM SHALL run `validate` / `before_save` /
  `after_save` around `insert` or `update`, so app hooks behave identically to a
  stored DocType.
- IF the controller throws, THEN THE SYSTEM SHALL surface it as a document error
  with the controller's message, and the control-DB transaction SHALL roll back.
- THE SYSTEM SHALL NOT promise atomicity between the controller's store and the
  control DB (same boundary as EDS-12).

**Examples:**

| Before | Action | After |
|---|---|---|
| — | Save `Deploy Log` | `validate` runs, `insert` called once, `after_save` runs |
| Controller's API returns 502 | Save | Save fails with the controller's message; no version row, no comment |

## VDT-4: Honest limitations

- THE SYSTEM SHALL reject a `Table` (child table) field on a virtual DocType
  rather than accept it and drop the rows, which is Frappe's documented
  in-memory-only behaviour and a recurring source of confusion.
- THE SYSTEM SHALL reject `unique` and database-enforced constraints on virtual
  fields, since nothing enforces them.
- THE SYSTEM SHALL exclude virtual DocTypes from link-integrity checks on delete
  and from cross-DocType SQL reports, and SHALL say so in the DocType form.
- WHERE a local DocType links to a virtual DocType, THE SYSTEM SHALL validate
  the link by calling `load`.

**Examples:**

| Input | Result |
|---|---|
| Add a `Table` field to `Deploy Log` | Rejected: "Child tables are not supported on virtual DocTypes" |
| Delete a doc a virtual DocType "links" to | Not blocked; documented on the DocType form |

## VDT-5: Desk parity

- THE SYSTEM SHALL render virtual DocTypes with the same generic `ListView` and
  `FormView`, with a badge marking them virtual (invariant 3).
- WHERE the controller cannot sort or filter on a field, THE SYSTEM SHALL let it
  declare that in its registration, and the Desk SHALL disable those controls
  rather than issue a request that silently ignores them.

**Examples:**

| Input | Result |
|---|---|
| Open `Deploy Log` list | Generic list, badge "virtual" |
| Controller declares `sortable: ['started_at']` | Column sort offered on `started_at` only |

---

## Business Validation

- **BV1!:** A virtual DocType never causes DDL. (critical: the whole point is
  that Featherbase owns no storage here.)
- **BV2:** Protocol completeness is validated at registration, not at first use.
- **BV3:** Features that cannot be honoured (child tables, unique constraints,
  link protection) are rejected at configuration time, never silently ignored.

## Permissions

- **P1:** Identical to any other DocType — DocPerm, roles, permlevels — applied
  before delegation. `if_owner` requires the controller to return an `owner`
  value.

## Data Model

**T1: DocType** — new field
- is virtual (yes/no)
- sortable fields, filterable fields (declared by the controller at registration,
  cached in meta)

## Verification (definition of done)

1. A sample app registers a virtual DocType backed by a fixture HTTP service.
2. HTTP against the running server: list with filters and paging, get one,
   create, update, delete — all observably hitting the fixture service.
3. A controller missing a method fails registration at boot with a named error.
4. Adding a child-table field to the virtual DocType is rejected.
5. Playwright: the generic list and form render it, with the virtual badge.
6. No `tab_*` table exists for it after the run.

## Out of Scope

- Any SQL pushdown, joins, or report-builder support.
- Child tables and unique constraints on virtual DocTypes.
- Postgres-backed sources — spec 0001 handles those far better.
