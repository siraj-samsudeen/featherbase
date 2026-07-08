# Backend Stack Comparison: Convex vs InstantDB vs Supabase

> **Provenance:** research agent report, 2026-07-08, all load-bearing claims verified against primary sources (official docs, LICENSE files, vendor blogs). Preserved verbatim. Decision recorded in [ADR 0001](../adr/0001-stack-convex-react-vite.md). Note: the report's index-workaround discussion predates the per-DocType-tables refinement ([ADR 0002](../adr/0002-storage-per-doctype-tables-plus-fieldindex-sidecar.md)) and the admin-triggered materialization ladder ([ADR 0004](../adr/0004-materialization-admin-triggered.md)).

---

# Frappe++ Backend Stack: Convex vs InstantDB vs Supabase

_Research report, July 2026. All load-bearing claims verified against primary sources (official docs, LICENSE files, vendor blogs); links inline._

## TL;DR

**Convex is the right choice for this product** — not because it wins criterion 1 outright (it doesn't; it requires a deliberate metadata-driven data design), but because it is the only candidate that is strong on criteria 2, 3, 4 and 5 simultaneously, and those are where Frappe++'s actual differentiation lives (live computed data + visual workflows). InstantDB is architecturally the _closest_ match to runtime user-defined schema but has essentially **no server-side execution story**, which kills the workflow engine requirement. Supabase is the most proven path for runtime schema (it's how Teable/Baserow work) but has **no query-level reactivity**, which makes Glide-style live computed columns entirely DIY.

---

## Comparison Table

| Criterion (priority order)                  | Convex                                                                                                                                                                                                    | InstantDB                                                                                                      | Supabase                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Runtime user-defined schema**          | 🟡 Possible, with design work. Tables auto-create on insert; schema.ts optional; but **indexes are deploy-time only** → must use metadata + generic-table/EAV design with composite indexes               | 🟢 Native fit. Triple store; attributes auto-create; **Platform API pushes schema (incl. indexes) at runtime** | 🟢 Proven pattern. Real dynamic DDL (Teable/Baserow do exactly this); pitfalls: PostgREST cache reload, ~1600-col limit, RLS sprawl       |
| **2. Reactive computed data (Glide-style)** | 🟢 Best in class. Deterministic reactive queries, transactionally consistent; Aggregate component for O(log n) rollups                                                                                    | 🟢 Good. Live InstaQL queries w/ WAL invalidation; **but no aggregations in client queries** (admin-only)      | 🔴 Weakest. Row-change events only, no query subscriptions; rollups DIY via triggers/matviews; postgres_changes scales poorly             |
| **3. Workflow / durable execution**         | 🟢 Best in class. `@convex-dev/workflow`: journaled, exactly-once mutations, `step.sleep()`, `step.awaitEvent()` (human-in-the-loop), retries, months-long runs; + Workpool, Crons, Action Retrier, Agent | 🔴 Nothing. No hosted functions, no scheduler, no queues. BYO Node server + Trigger.dev/Inngest                | 🟡 Building blocks. Queues (pgmq), pg_cron, Edge Functions (2s CPU / 400s wall); no native durable engine — pair with Trigger.dev/Inngest |
| **4. Row-level permissions**                | 🟢 Code-level = fully dynamic; ideal when tables themselves are user-defined data                                                                                                                         | 🟢 CEL rules (`auth.id`, `data.ref`), updatable at runtime via Platform API                                    | 🟡 Postgres RLS is gold-standard, but policies must be templated/generated per runtime-created table                                      |
| **5. Deterministic testing**                | 🟢 Best. `convex-test` (pure-JS mock, Vitest, **fake-timer control of scheduler**) + OSS local backend for integration                                                                                    | 🔴 DIY. No test harness; self-host Clojure server + Postgres in Docker                                         | 🟡 Good local stack (CLI, Docker, `db reset` + seed, pgTAP); no time control; slower cycles                                               |
| **6. Self-hosting & license**               | 🟡 FSL-1.1-Apache-2.0 (non-compete clause; each release → Apache-2.0 after 2 yrs); Docker self-host incl. dashboard, works on Postgres/SQLite/Neon                                                        | 🟢 Apache-2.0, full stack OSS; but self-host tooling immature (community guides, docker-compose still rough)   | 🟢 Apache-2.0 core; self-host is a many-service docker-compose — proven but operationally heavy                                           |
| **7. Scale & maturity**                     | 🟡 $26M Series A (a16z, 2022), ~11 devs (2025); solid tech, small company                                                                                                                                 | 🔴 $3.4M seed (YC S22; PG, James Tamplin, Brockman, Dean); tiny team                                           | 🟢 $100M Series E @ $5B (Oct 2025); 4M devs, 100k+ customers; Postgres maturity                                                           |

---

## 1. Runtime user-defined schema (the make-or-break)

### Convex — possible, but you must design around deploy-time indexes

Verified facts from primary docs:

- **Schema is optional.** "While it is possible to use Convex without defining a schema…" and `schemaValidation: false` disables runtime validation entirely ([Schemas docs](https://docs.convex.dev/database/schemas)).
- **Tables are created automatically on first insert** — no migration, no declaration ([Database docs](https://docs.convex.dev/database)). Even _with_ a schema: "your schema will only validate documents in the tables listed in the schema. You can still create and modify documents in other tables" ([Schemas docs](https://docs.convex.dev/database/schemas)). So `ctx.db.insert(dynamicTableName, {...})` works at runtime (TypeScript needs `AnyDataModel`/cast, but the runtime allows it).
- **The hard constraint: indexes are schema-file-only.** Indexes are "defined as part of your Convex schema," deployed and backfilled on deploy; there is **no runtime index creation** ([Indexes docs](https://docs.convex.dev/database/reading-data/indexes/)). Limits: 32 indexes/table, 16 fields/index.
- Relevant [limits](https://docs.convex.dev/production/state/limits): 10,000 tables/deployment, 32,000 documents scanned per transaction, 16 MiB read per function, 1 MiB/doc, 1024 fields/doc.

**Consequence:** a naive table-per-DocType design gives you dynamic tables but no way to index user-defined fields, so sorts/filters degrade to `.filter()` scans capped at 32k scanned docs. The workable pattern — which is essentially what Frappe itself does with `tabDocType` metadata, and what Glide does internally — is **metadata-driven generic storage**: a `doctypes` table + `fields` table define the schema _as data_; records live either in (a) a generic `documents` table with a `data` object, plus (b) an EAV-style `values` index table with composite indexes on _fixed_ columns like `[docTypeId, fieldId, value]`. Fixed composite indexes over generic columns serve _arbitrary_ user-defined fields — that's the trick that makes Convex viable here. It's real design work you own, not something the platform gives you.

### InstantDB — this is literally its native data model

- Instant "store[s] all user data as **triples** in one big Postgres database" with a Clojure sync server ([repo README](https://github.com/instantdb/instant)).
- **Attributes and namespaces auto-create at runtime**: "Any time you write `transact`, we'll automatically create missing entities for you" ([Modeling data](https://www.instantdb.com/docs/modeling-data)); you can lock this down with perms when you don't want it.
- The killer feature for Frappe++: the **[Platform API / SDK](https://www.instantdb.com/docs/platform-api)** (`@instantdb/platform`, with [OAuth scopes](https://www.instantdb.com/docs/auth/platform-oauth) `apps-read`/`apps-write`) lets your product **programmatically create apps, push schema, and update permissions** — `schemaPush` even runs background jobs (index backfills) before returning. Instant's own dashboard is built this way. This is a first-class, supported answer to "end users define schema at runtime."
- Query caveats ([InstaQL docs](https://www.instantdb.com/docs/instaql)): comparison operators (`$gt`, `$lt`…) and `order` **require the attribute to be indexed and type-checked** (runtime-indexable via schema push, so consistent with the model); no ordering on nested attributes; **no aggregations in client queries** — count/aggregates are admin-only per the [source](https://github.com/instantdb/instant/blob/main/server/src/instant/db/instaql.clj).

### Supabase — the proven, sharp-edged path

- Runtime DDL is exactly how the successful open-source Airtable clones work: **Teable** — "Every table you see corresponds to a physical table in Postgres" ([Teable blog](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion), [repo](https://github.com/teableio/teable)); **Baserow** — real table per user table (`database_table_{id}`), one column per field (`field_{id}`), dynamic Django models, no migrations ([Baserow technical docs](https://baserow.io/docs/technical/introduction)); NocoDB is a UI over existing DBs.
- Pitfalls, confirmed: **PostgREST schema cache must be reloaded after DDL** — `NOTIFY pgrst, 'reload schema'`, automatable with a DDL event trigger ([PostgREST schema cache docs](https://docs.postgrest.org/en/stable/references/schema_cache.html)); Postgres's ~1600-column-per-table ceiling; ALTER TABLE locking; and your migration tooling no longer describes production schema. Most builders bypass PostgREST for user tables and go through their own API layer — at which point you're using Supabase as managed Postgres.

**Verdict on #1:** InstantDB > Supabase > Convex on _nativeness_; all three are viable. Convex requires committing to the metadata/EAV design up front.

## 2. Reactive computed data

- **Convex:** reactive queries are deterministic, transactionally consistent, and auto-invalidate — a computed column/rollup is just a query function, and every subscribed client updates live. For large aggregations, the official [Aggregate component](https://www.convex.dev/components/aggregate) gives O(log n) counts/sums instead of scans. This is the closest 1:1 match to Glide's computed-column mental model.
- **InstantDB:** live queries via WAL-tailing invalidation (architecture inspired by Figma's LiveGraph — [repo](https://github.com/instantdb/instant)). Lookups/joins are natural (links), but **rollups are not**: no client-side aggregation means you denormalize counters in transactions or compute in your own server layer.
- **Supabase:** [postgres_changes](https://supabase.com/docs/guides/realtime/postgres-changes) delivers row-change events, not query results. Every change is authorization-checked **per subscriber** (100 subscribers × 1 insert = 100 reads), change processing is **single-threaded**, and Supabase's own guidance at scale is to re-stream via Broadcast. Live computed columns mean: triggers/matviews to compute, broadcast to notify, client re-fetch — all yours to build and keep correct.

**Verdict:** Convex clearly first; InstantDB second; Supabase a distant third.

## 3. Workflow / durable execution

- **Convex:** [`@convex-dev/workflow`](https://github.com/get-convex/workflow) is a real durable-execution engine: journaled steps, "mutations have **exactly-once** execution," workflows "can run for months, and survive server restarts," `step.sleep()`, **`step.awaitEvent()`** (human-in-the-loop pause), per-step retry policies with backoff, parallel steps, cancellation, `onComplete`, nested workflows. Constraints: handler determinism is enforced (patched `Date`/`Math.random`, changing step structure mid-run → determinism violation), 8 MiB journal, ~1 MB step data. For a _visual_ builder where workflows are user data, the pattern is an **interpreter workflow**: step 1 snapshots the user's workflow definition via a journaled `step.runQuery`, then iterates its steps as `step.runAction/runMutation` calls — journaling keeps replays consistent even though the definition is data. You build the interpreter; the durability substrate is given. Supporting cast: [Workpool, Crons, Action Retrier, Rate Limiter, Agent, Migrations components](https://www.convex.dev/components) plus the built-in scheduler.
- **InstantDB:** honest answer — **nothing**. The [backend docs](https://www.instantdb.com/docs/backend) offer an admin SDK for queries/transactions from _your_ server; there are no hosted functions, no scheduled jobs, no queues, no cron. Your workflow engine would live on separate infrastructure (Node + Trigger.dev/Inngest/Temporal) with Instant as the data store.
- **Supabase:** good primitives, no engine: [Queues on pgmq](https://supabase.com/docs/guides/queues) (durable, RLS-controllable, exactly-once within a visibility window), [pg_cron scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Edge Functions](https://supabase.com/docs/guides/functions/limits) capped at **2s CPU / 256MB / 150–400s wall clock**. Multi-step, retryable, waitable, human-in-the-loop workflows are DIY state machines over queues — or you adopt Trigger.dev/Inngest and now run a second platform.

**Verdict:** Convex decisively first. This criterion alone eliminates InstantDB for this product.

## 4. Permissions (Glide "Row Owners")

- **Convex:** no declarative RLS — authorization is code in each query/mutation (helpers exist in `convex-helpers`). Normally listed as a weakness; **for Frappe++ it's a strength**: since DocTypes and their permission rules are themselves runtime data, code that evaluates stored permission metadata (roles, row-owner fields, Frappe-style perm levels) is strictly more flexible than any static policy language. Row Owners = a `where owner == ctx.auth.subject` predicate applied centrally in your data-access layer.
- **InstantDB:** [CEL-based rules](https://www.instantdb.com/docs/permissions) (`auth.id`, `data.ref()`, `auth.ref()`, `ruleParams`, `bind`) — expressive enough for row owners, and updatable at runtime via the Platform API.
- **Supabase:** Postgres RLS is the most battle-tested — but with runtime-created tables you must **generate policies via templated DDL per table**, and Supabase's own docs note complex RLS degrades performance and Realtime authorization throughput ([RLS docs](https://supabase.com/docs/guides/database/postgres/row-level-security), [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization)).

## 5. Testability

- **Convex:** [`convex-test`](https://docs.convex.dev/testing/convex-test) is a pure-JS backend mock on Vitest/edge-runtime with **deterministic time control** — `vi.useFakeTimers()` + `t.finishInProgressScheduledFunctions()` let you fast-forward scheduled functions and workflow sleeps. Known gaps: search fidelity, no size/time-limit enforcement, no crons. For full fidelity, the [open-source local backend](https://docs.convex.dev/testing) runs your entire deployment locally in CI. You already have a Convex testing library and a 12-point testing philosophy — this asset transfers 1:1.
- **InstantDB:** no test harness. Integration tests mean self-hosting the Clojure server + Postgres in Docker (community-documented, not productized). No time control.
- **Supabase:** solid local story — CLI Docker stack, `supabase db reset` + seed scripts, pgTAP for database tests — but no time control for cron/queue flows and slower cycle times than an in-process mock.

## 6. Self-hosting & licensing

- **Convex:** backend is source-available under **FSL-1.1-Apache-2.0** ([LICENSE](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md)): free for any use _except_ "a commercial product or service that… substitutes for the Software" — i.e., you can't resell Convex-as-a-BaaS; **each release automatically converts to Apache 2.0 after two years**. Two important readings: (1) if you build on **Convex Cloud**, FSL doesn't constrain your product at all — it's a source license, not a ToS; (2) if you later _self-host_ Convex under Frappe++, an end-user app-builder is plausibly not a "substitute for Convex" (a developer backend platform), but it's a gray zone worth a lawyer's hour if Frappe++ ever exposes raw backend primitives to developers. [Self-hosting](https://github.com/get-convex/convex-backend) ships Docker + dashboard + CLI and "works well with Neon, Fly.io, Vercel, Netlify, RDS, Sqlite, Postgres."
- **InstantDB:** genuinely **Apache-2.0**, whole stack ([repo](https://github.com/instantdb/instant)). Self-hosting is possible but immature — community guides exist; a docker-compose ask sat as [issue #34](https://github.com/instantdb/instant/issues/34). Cleanest license, roughest ops.
- **Supabase:** **Apache-2.0** core ([repo](https://github.com/supabase/supabase)) with MIT/Apache components. Self-hosting is well-trodden but a heavy multi-service compose (Postgres, PostgREST, Realtime, Auth, Storage, Studio, Kong…).

## 7. Scale & maturity

- **Convex:** [$26M Series A, a16z, 2022](https://news.convex.dev/tag/financing/); averaged ~11 developers in 2025 per their [Open Source Pledge post](https://news.convex.dev/open-source-pledge/); shipped and then [open-sourced Chef](https://news.convex.dev/open-kitchen-chef-is-now-oss/); official [TanStack partner](https://tanstack.com/partners/convex). Technically excellent, commercially small — the honest risk is vendor longevity, partially hedged by the FSL→Apache conversion and the self-host path.
- **InstantDB:** YC S22, **$3.4M seed** (Paul Graham, James Tamplin, Greg Brockman, Jeff Dean — per [their site](https://www.instantdb.com/hiring/backend-engineer)); tiny team, still hiring founding engineers in 2026. Highest platform risk of the three.
- **Supabase:** [$100M Series E at $5B](https://supabase.com/blog/supabase-series-e) ([TechCrunch](https://techcrunch.com/2025/10/03/supabase-nabs-5b-valuation-four-months-after-hitting-2b/)), 4M developers, 100k+ customers, building Multigres for horizontal Postgres scale. Effectively zero platform risk; it's Postgres underneath.

---

## Fatal flaws per option

**Convex**

- **No runtime index creation.** Arbitrary user-field filtering/sorting must be engineered via composite indexes over generic EAV columns; get this wrong and you hit the 32k-documents-scanned wall. This is the single design decision the whole product rests on.
- Aggregations over big user tables need the Aggregate component or denormalized counters — not free-form.
- FSL gray zone _only_ in a future self-hosted-Convex distribution scenario.
- Small company (~11 devs, seed+A funding); mitigated but not eliminated by source availability.

**InstantDB**

- **No server-side execution, period.** No functions, no jobs, no cron, no queues. Requirement 3 (the workflow engine) would live entirely on infrastructure you build and operate beside it. For a product whose second pillar is workflows, this is disqualifying.
- No client-side aggregations (admin-only) → rollups are manual denormalization.
- $3.4M-seed-stage company as your data platform = existential dependency; Apache-2.0 self-hosting is the hedge, but you'd be adopting a Clojure codebase.

**Supabase**

- **No query-level reactivity.** Glide-style live computed columns — the heart of the product — must be hand-built from triggers, materialized views, and Broadcast; postgres_changes' per-subscriber auth checks and single-threaded ordering are a documented scaling trap.
- Runtime DDL works (Teable/Baserow prove it) but drags in PostgREST cache reloads, per-table RLS policy generation, and migration-tooling mismatch — you end up building your own API layer over managed Postgres.
- Durable workflows are not native; you'll bolt on Trigger.dev/Inngest and split your backend across two platforms with two mental models.

---

## Frontend: React + Vite vs Svelte (ecosystem only)

React + Vite, and it isn't close for _this_ product category. The builder-critical libraries are React-first or React-only: [Glide Data Grid](https://github.com/glideapps/glide-data-grid) (the canvas grid extracted from Glide itself) is React; AG Grid's flagship wrapper is React; [React Flow / @xyflow](https://reactflow.dev) (your visual workflow editor) is far more mature than the younger Svelte Flow; dnd-kit, Radix/shadcn, TanStack Table/Virtual/Form are all React-first. Backend SDKs point the same way: Convex's React bindings are first-class while [convex-svelte](https://www.npmjs.com/package/convex-svelte) is a thin layer and the SvelteKit integration is [explicitly experimental](https://github.com/axel-rock/convex-sveltekit); InstantDB is React-first too. Add the hiring pool and the fact that LLM codegen is measurably strongest at React, and Svelte 5's genuine DX advantages don't pay for the ecosystem gap. **TanStack Start** (Convex is an official [TanStack partner](https://tanstack.com/partners/convex) and funded Start's development) is the natural router/SSR shell if you want one; **Next.js adds nothing** for an authenticated SPA builder — RSC/SEO-oriented machinery for a product that is 95% behind a login.

---

## Recommendation

**Build Frappe++ on Convex, with React + Vite (TanStack Router/Start), and architect the DocType layer for portability from day one.**

Why the priorities resolve this way:

1. **Criterion 1 is solvable on Convex; criteria 2–3 are not solvable-well anywhere else.** The metadata-driven DocType engine (doctypes/fields/documents/values tables with fixed composite indexes) is a known, bounded design problem — and it's philosophically _exactly_ how Frappe works (DocType metadata driving generic storage), so it fits the product's DNA. By contrast, Supabase's missing query reactivity and InstantDB's missing server runtime are not design problems you solve — they're platforms you'd have to build.
2. **Your existing assets compound.** You have Convex experience, a Convex testing library, and a testing philosophy built around convex-test's deterministic time control. On criterion 5 — the one that keeps a solo/small-team project shippable — Convex is already your best stack, and switching forfeits that.
3. **The workflow pillar is nearly free.** `@convex-dev/workflow` + Workpool + Crons give you journaled, exactly-once, human-in-the-loop durable execution; your work is the interpreter that executes user-defined workflow definitions as journaled steps — comparable in spirit to what you'd borrow from Activepieces (MIT), but on a durable substrate you don't operate.

**The strongest counterargument to Convex** — state it honestly: _you are betting the product's storage engine on a ~dozen-person, Series-A company and accepting a lifetime of working around deploy-time indexes, when Supabase offers boring, unkillable Postgres where user tables are real tables, filtering/sorting/aggregating arbitrary fields is just SQL with runtime `CREATE INDEX`, and the vendor will outlive your product._ If Frappe++'s essence were "a user-defined relational database" (Teable's product), this argument should win. It doesn't win here because Frappe++'s essence is _live computed data + workflows over user-defined schema_ — and on Supabase you'd spend your first six months hand-building a reactivity layer that Convex gives you in its first hour, while still bolting on Trigger.dev for workflows.

**The hybrid / escape hatch — yes, design for it, don't build it yet:**

- Keep **DocType metadata and workflow definitions as portable JSON documents** (Frappe-style), never as Convex-specific artifacts. These are your crown jewels and they must be backend-agnostic.
- Route all record access through a **single repository/data-access layer** keyed on DocType metadata — this is the only seam you'd ever need to re-implement on Postgres if you outgrow Convex or need SQL analytics.
- The risk hedge is layered: Convex Cloud today → self-hosted Convex (runs on Postgres; FSL converts each release to Apache-2.0 after two years) → Postgres port through the repository seam as the last resort.
- Skip the "Convex for app + Supabase for data" split now — two reactivity models and two permission systems is complexity the product can't afford at this stage.

### Sources

Convex: [Schemas](https://docs.convex.dev/database/schemas) · [Database](https://docs.convex.dev/database) · [Indexes](https://docs.convex.dev/database/reading-data/indexes/) · [Limits](https://docs.convex.dev/production/state/limits) · [Testing](https://docs.convex.dev/testing) · [convex-test](https://docs.convex.dev/testing/convex-test) · [Workflow component](https://github.com/get-convex/workflow) · [Components](https://www.convex.dev/components) · [convex-backend + LICENSE](https://github.com/get-convex/convex-backend) · [Financing](https://news.convex.dev/tag/financing/) · [Open Source Pledge](https://news.convex.dev/open-source-pledge/) · [Chef OSS](https://news.convex.dev/open-kitchen-chef-is-now-oss/) · [TanStack partner](https://tanstack.com/partners/convex) · [convex-svelte](https://www.npmjs.com/package/convex-svelte) · [convex-sveltekit](https://github.com/axel-rock/convex-sveltekit)
InstantDB: [Repo (Apache-2.0)](https://github.com/instantdb/instant) · [Modeling data](https://www.instantdb.com/docs/modeling-data) · [InstaQL](https://www.instantdb.com/docs/instaql) · [Permissions](https://www.instantdb.com/docs/permissions) · [Platform API](https://www.instantdb.com/docs/platform-api) · [Platform OAuth](https://www.instantdb.com/docs/auth/platform-oauth) · [Backend/admin SDK](https://www.instantdb.com/docs/backend) · [Aggregates admin-only (source)](https://github.com/instantdb/instant/blob/main/server/src/instant/db/instaql.clj) · [Company/funding](https://www.instantdb.com/hiring/backend-engineer) · [Self-host issue #34](https://github.com/instantdb/instant/issues/34)
Supabase: [Repo (Apache-2.0)](https://github.com/supabase/supabase) · [PostgREST schema cache](https://docs.postgrest.org/en/stable/references/schema_cache.html) · [postgres_changes](https://supabase.com/docs/guides/realtime/postgres-changes) · [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization) · [Queues](https://supabase.com/docs/guides/queues) · [Queues blog](https://supabase.com/blog/supabase-queues) · [Edge Function limits](https://supabase.com/docs/guides/functions/limits) · [Scheduling functions](https://supabase.com/docs/guides/functions/schedule-functions) · [Series E](https://supabase.com/blog/supabase-series-e) · [TechCrunch $5B](https://techcrunch.com/2025/10/03/supabase-nabs-5b-valuation-four-months-after-hitting-2b/)
Airtable-clone architectures: [Teable](https://github.com/teableio/teable) · [Teable: Postgres-Airtable fusion](https://blog.teable.io/blog/data-reimagined-postgres-airtable-fusion) · [Baserow technical intro](https://baserow.io/docs/technical/introduction) · [Baserow database plugin](https://baserow.io/docs/technical/database-plugin)
Frontend: [Glide Data Grid](https://github.com/glideapps/glide-data-grid) · [React Flow / xyflow](https://reactflow.dev) · [Convex Svelte docs](https://docs.convex.dev/client/svelte)
