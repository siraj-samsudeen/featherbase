# ADR 0001: Convex + React + Vite + TanStack Router

**Status:** Superseded by [ADR 0006](0006-stack-react-hono-postgres.md) · **Date:** 2026-07-08

## Context

Featherbase needs a backend for a metadata-driven platform with four hard requirements, in priority order: (1) runtime user-defined schema, (2) Glide-style reactive computed data, (3) durable workflow execution (retries, waits, human-in-the-loop), (4) deterministic automated testing. Candidates: Convex, InstantDB, Supabase. Full analysis: [research/stack-comparison.md](../research/stack-comparison.md).

An existing asset weighs on the decision: [feather-testing-convex](https://github.com/siraj-samsudeen/feather-testing-convex) + a proven testing philosophy built around `convex-test`'s in-memory backend and fake-timer control.

## Decision

**Convex** backend; **React + Vite + TanStack Router** frontend.

## Why

- Criterion 1 is _solvable by design_ on Convex (see ADR 0002); criteria 2–4 are _not solvable well_ anywhere else:
  - **InstantDB** has no server-side execution at all (no functions, jobs, cron, queues) — disqualifying for the workflow pillar — and no test harness.
  - **Supabase** has no query-level reactivity (row events only) — Glide-style live computed columns would mean hand-building a reactivity layer — and durable workflows require bolting on a second platform (Trigger.dev/Inngest).
- `@convex-dev/workflow` provides journaled, exactly-once, restart-surviving execution with `step.sleep()` and `step.awaitEvent()` — the human-in-the-loop primitive — for free.
- The testing asset transfers 1:1. On InstantDB the in-memory backend would have to be built from scratch (~10× the library's size); on Supabase testing drops to Docker-grade.
- React over Svelte: the builder-critical ecosystem is React-first or React-only (Glide Data Grid, React Flow, dnd-kit, TanStack suite), Convex's React bindings are first-class, and LLM codegen is strongest at React.

## The counterargument we accepted

Supabase is boring, unkillable Postgres where user tables are real tables and runtime `CREATE INDEX` is trivial — and Supabase ($5B, 4M devs) will outlive Convex (~11 people, Series A, FSL-licensed). We accept this because Featherbase's essence is _live computed data + workflows_, the two things Supabase gives least of, and the risk is hedged three layers deep: Convex Cloud → self-hosted Convex (FSL converts each release to Apache-2.0 after two years; runs on Postgres) → a Postgres port through the repository seam.

## Consequences

- **Invariant:** DocType metadata and flow definitions are portable JSON, never Convex-specific artifacts.
- **Invariant:** all record access goes through one repository layer — the only seam a future Postgres port would re-implement.
- No runtime index creation on Convex → the storage design of ADR 0002.
- Rejected: hybrid Convex-for-app + Supabase-for-data (two reactivity and permission models is unaffordable complexity now).
