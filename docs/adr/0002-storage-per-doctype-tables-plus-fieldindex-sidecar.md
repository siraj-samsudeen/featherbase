# ADR 0002: Per-DocType tables + fieldIndex sidecar

**Status:** Superseded by [ADR 0006](0006-stack-react-hono-postgres.md) · **Date:** 2026-07-08

## Context

Frappe creates a **real database table per DocType** — including user-created custom DocTypes at runtime (`DocType.on_update` → `frappe.db.updatedb` → `CREATE TABLE`, with real columns and indexes; custom fields become `ALTER TABLE`). That symmetry — developer-defined and user-defined tables get identical physical treatment — is a property worth preserving.

Convex allows **runtime table creation** (tables auto-create on first insert) but **not runtime index creation** (indexes exist only in the deploy-time `schema.ts`). Copying Frappe's layout naively would give runtime tables whose user-defined fields can only be filtered by full scan (32k documents-scanned cap per transaction).

## Decision

1. **Every DocType gets its own Convex table**, auto-created on first insert, holding full records with Frappe-style system fields (`name`, `owner`, `creation`, `modified`, `docstatus`).
2. **One fixed sidecar table** `fieldIndex: {doctype, field, value, docId}` with a composite index on `[doctype, field, value]` serves filter/sort for fields that don't have native indexes. Because the sidecar is fixed, its deploy-time indexes serve arbitrary user-defined fields forever.
3. The repository layer maintains sidecar rows on write — **only for fields marked filterable/sortable in DocType metadata** (Frappe's `in_standard_filter` concept), so write amplification is opt-in per field.
4. Reads by id and grid views hit the DocType's own table directly; the sidecar exists purely to answer "filter/sort by any user field" without scans.

## Consequences

- **Promotion never moves data** — a runtime table's records already live in their own table; every rung of the ladder (ADR 0004) is a metadata/codegen change.
- Both modes are physically symmetric, like Frappe.
- Per-table inspectability in the Convex dashboard, per-table export.
- A future Postgres port maps 1:1 onto Frappe/Baserow's real-DDL model; the sidecar dissolves into native `CREATE INDEX`.
- Aggregations over large tables use the Convex Aggregate component or denormalized counters — free-form aggregation is not a goal of this layer (computed columns, capability 8, own that).

## Alternatives rejected

- **Single generic `documents` table (pure EAV):** loses Frappe symmetry, dashboard inspectability, and per-table operations; no compensating benefit since the sidecar carries indexed queries either way.
- **Shared "hot records" table with pre-provisioned indexed slot fields:** promotion without deploys, but reintroduces data migration on promotion (the exact Frappe failure mode this design eliminates), slot ceilings, and type coercion.
