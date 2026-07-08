# ADR 0004: Index materialization is admin-triggered (stats-suggested later)

**Status:** Accepted · **Date:** 2026-07-08

## Context

Runtime (site-source) DocTypes filter through the fieldIndex sidecar (ADR 0002) — functional, but below native-index performance, with per-field write amplification. When a runtime table proves popular, it should be able to gain real Convex indexes. Developer-mode DocTypes always have native indexes via codegen (ADR 0003); the question is the upgrade path for runtime tables, and who triggers it.

Because records already live in per-DocType tables, materialization is **adding the table to the generated `schema.ts` and deploying** — Convex validates and backfills indexes in place, blocking the push until indexes are usable. To be risk-free for tables with messy legacy rows, the generated entry starts as `defineTable(v.any()).index(...)` — indexes without strict validation — tightened to a full generated validator later if promoted to a package.

## Decision

**Admin-triggered materialization (Option 2), with stats-driven batch suggestions (Option 3) added later on the same plumbing.**

The admin opens a DocType's performance panel → picks fields to index → the platform regenerates `schema.ts` from package JSONs + a materialization registry → a deploy runs (self-hosted: CLI `materialize` + `convex deploy`; managed: one click triggering CI or the Convex deploy API) → repository metadata flips that DocType's filter path from sidecar to native → a cleanup job drops its sidecar rows.

The resulting ladder — each rung a metadata/codegen change, zero data movement, independently reversible, round-trip tested:

| Tier | Definition lives | Query path | How you get here |
|---|---|---|---|
| Runtime | DB row | Sidecar | User creates it in the UI |
| Materialized | DB row | Native indexes | Admin one-click + deploy |
| Package | JSON in git | Native indexes + typed validator + code hooks | Developer writes it, or promotes |

Later (same mechanics): a scheduled "schema sync" that batches pending materializations and *suggests* candidates from sidecar query statistics.

## Consequences

- `schema.ts` is a **fully generated artifact** — deterministic output of (package JSONs + materialization registry), committed, never hand-edited.
- Deploy credentials must be reachable from the admin flow (a deploy key in CI) — a real but manageable security surface.
- Index backfill on huge tables takes time; bounded and automatic.

## Alternatives rejected

- **Sidecar forever:** leaves the explicit requirement (admin upgrade path) unmet.
- **Instant auto-deploy on every runtime table creation:** production deploys triggered by arbitrary user actions — latency on the user's click, blast radius, deploy-key on the hot path.
- **Pre-provisioned index slots:** promotion without deploys, but requires migrating rows into a shared table — the Frappe failure mode this architecture exists to eliminate.
