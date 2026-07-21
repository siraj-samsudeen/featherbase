# ADR 0004: Index materialization is admin-triggered (stats-suggested later)

**Status:** Superseded by [ADR 0006](0006-stack-react-hono-postgres.md) · **Date:** 2026-07-08 · **Amended:** 2026-07-08 (staged indexes — see below)

## Context

Runtime (site-source) DocTypes filter through the fieldIndex sidecar (ADR 0002) — functional, but below native-index performance, with per-field write amplification. When a runtime table proves popular, it should be able to gain real Convex indexes. Developer-mode DocTypes always have native indexes via codegen (ADR 0003); the question is the upgrade path for runtime tables, and who triggers it.

Because records already live in per-DocType tables, materialization is **adding the table to the generated `schema.ts` and deploying** — Convex validates and backfills indexes in place, blocking the push until indexes are usable. To be risk-free for tables with messy legacy rows, the generated entry starts as `defineTable(v.any()).index(...)` — indexes without strict validation — tightened to a full generated validator later if promoted to a package.

## Decision

**Admin-triggered materialization (Option 2), with stats-driven batch suggestions (Option 3) added later on the same plumbing.**

The admin opens a DocType's performance panel → picks fields to index → the platform regenerates `schema.ts` from package JSONs + a materialization registry → a deploy runs (self-hosted: CLI `materialize` + `convex deploy`; managed: one click triggering CI or the Convex deploy API) → repository metadata flips that DocType's filter path from sidecar to native → a cleanup job drops its sidecar rows.

The resulting ladder — each rung a metadata/codegen change, zero data movement, independently reversible, round-trip tested:

| Tier         | Definition lives | Query path                                    | How you get here                 |
| ------------ | ---------------- | --------------------------------------------- | -------------------------------- |
| Runtime      | DB row           | Sidecar                                       | User creates it in the UI        |
| Materialized | DB row           | Native indexes                                | Admin one-click + deploy         |
| Package      | JSON in git      | Native indexes + typed validator + code hooks | Developer writes it, or promotes |

Later (same mechanics): a scheduled "schema sync" that batches pending materializations and _suggests_ candidates from sidecar query statistics.

## Consequences

- `schema.ts` is a **fully generated artifact** — deterministic output of (package JSONs + materialization registry), committed, never hand-edited.
- Deploy credentials must be reachable from the admin flow (a deploy key in CI) — a real but manageable security surface.
- Index backfill on huge tables takes time; bounded and automatic — and no longer deploy-blocking (see amendment).

## Amendment — staged indexes (2026-07-08)

Convex now supports **staged indexes**: `.index("...", [...], { staged: true })` backfills asynchronously **without blocking the deploy**, monitored in the dashboard, and a follow-up deploy removes the flag to enable the index ([docs](https://docs.convex.dev/database/reading-data/indexes/), verified 2026-07-08; [revalidation report](../research/revalidation-2026-07.md)). This refines the mechanism, not the decision:

1. Materialization deploy emits the new index entries **staged** — the deploy returns immediately even on huge tables.
2. The platform monitors backfill state; when ready, a second generated deploy enables the index.
3. Only then does repository metadata flip the DocType's filter path from sidecar to native, and the sidecar-cleanup job runs.

The "blocking the push until indexes are usable" behavior described in Context remains the default for non-staged indexes and is still fine for small tables; the codegen should choose staged automatically above a row-count threshold.

## Alternatives rejected

- **Sidecar forever:** leaves the explicit requirement (admin upgrade path) unmet.
- **Instant auto-deploy on every runtime table creation:** production deploys triggered by arbitrary user actions — latency on the user's click, blast radius, deploy-key on the hot path.
- **Pre-provisioned index slots:** promotion without deploys, but requires migrating rows into a shared table — the Frappe failure mode this architecture exists to eliminate.
