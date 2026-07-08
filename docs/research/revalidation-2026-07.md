# Decision Revalidation — July 2026

> **Provenance:** review requested by the owner ("in the light of current technology, reconsider every decision"), executed 2026-07-08 by a Claude agent with parallel web-research subagents. Every load-bearing claim below was live-checked against primary sources on 2026-07-08; URLs inline. Scope: the five ADRs, the conventions adopted in issue #2 (inherited from feather-testing-convex), and the three-step capability workflow (research → spec → plan).

## A correction to the premise, first

The owner's request assumed the repo's decisions were made ~6 months ago under older models. The repo says otherwise: every ADR, research report, and the capability-1 docs are dated **2026-07-08**, and capability 1's version pins were verified against the live npm registry the same day. What _is_ ~6 months old is the upstream source of the conventions — **feather-testing-convex** (built Feb–May 2026) and its testing philosophy, which were formed in a more manual, human-in-the-loop era. So the right question is not "are stale decisions still valid" but "do conventions born in the manual era still earn their keep in an agent-first loop." That is the question this review answers.

## Verdict table

| Decision                                                                                    | Verdict                                 | One-line reason                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| ADR 0001 — Convex + React + Vite + TanStack Router                                          | **Valid — strengthened**                | Both disqualifiers of the alternatives still hold this week; Convex's company risk shrank |
| ADR 0002 — per-DocType tables + fieldIndex sidecar                                          | **Valid**                               | Convex still has no runtime index creation (re-verified 2026-07-08)                       |
| ADR 0003 — JSON definitions, package\|site sources                                          | **Valid**                               | Nothing changed; agent-authored validated artifacts are now the industry direction        |
| ADR 0004 — admin-triggered materialization                                                  | **Valid — improve with staged indexes** | New Convex `staged: true` indexes remove the deploy-blocking backfill pain                |
| ADR 0005 — Featherbase name                                                                 | **Valid**                               | No new collisions surfaced; low stakes                                                    |
| Issue #2 conventions (ESM, strict TS, npm, Vitest, ESLint+Prettier, 100% coverage, CI gate) | **Valid**                               | Each survives 2026 scrutiny; details below                                                |
| Three-step capability workflow                                                              | **Valid — right-size it**               | The industry converged on the same shape; scale artifacts to risk, keep one human gate    |

## ADR-by-ADR evidence

### ADR 0001 — stack (reaffirmed)

The decision rested on two disqualifiers, both re-verified 2026-07-08:

- **InstantDB still has no server-side execution** — no hosted functions, jobs, cron, or queues. 2026 additions (outbound [Webhooks](https://www.instantdb.com/docs/webhooks), [Streams](https://www.instantdb.com/docs/streams)) are triggers/transport, not a runtime. The workflow pillar remains impossible there without a second platform.
- **Supabase still has no query-level reactivity** — Realtime remains Broadcast/Presence/Postgres Changes ([docs](https://supabase.com/docs/guides/realtime); confirmed by Supabase's own [May 2026 post](https://supabase.com/blog/realtime-or-pipelines-how-to-choose-the-right-tool)). The 2022 query-subscription request ([realtime-js#221](https://github.com/supabase/realtime-js/issues/221)) is still open. 2026's Pipelines launch is warehouse ETL, not client reactivity.

The accepted counterargument (Convex is small) weakened materially: **$24M raise Nov 2025** led by a16z + Spark ([announcement](https://news.convex.dev/convex-raises-24m/)), **Enterprise launch Apr 2026** with "nearly 10,000 paying teams" ([post](https://news.convex.dev/enterprise-launch/)), EU region Feb 2026, active releases through July 2026. License unchanged: FSL-1.1 with the 2-year Apache-2.0 conversion ([LICENSE](https://github.com/get-convex/convex-backend/blob/main/LICENSE.md)) — the hedge stands. `convex-test` is actively maintained (0.0.54, 2026-06-27). **Caution for capability 6:** `@convex-dev/workflow` is active (0.4.4, 2026-06-10) but still pre-1.0 — pin exactly and keep it behind the interpreter seam, which ADR 0001's repository-layer invariant already guarantees.

Frontend side: TanStack Router is stable and actively developed; TanStack **Start** is still RC as of 2026-07-08 ([official page](https://tanstack.com/start/latest) — third-party "v1 shipped" claims are wrong), so the repo's Router-without-Start choice dodged real churn. TanStack **DB** (the new reactive client store) is beta with **no official Convex collection** — only a 0.0.x community adapter — so the TanStack Query bridge remains the correct Convex data layer. Watch DB; don't adopt.

**One frontend datapoint aged badly: Glide Data Grid.** `@glideapps/glide-data-grid` has had no npm release since 6.0.3 on **2024-02-03** (~2.5 years). It is cited in ADR 0001's ecosystem rationale and is the assumed grid for capability 3. This doesn't change the React decision (the point was ecosystem breadth, which holds), but capability 3's research step must re-evaluate the grid choice — maintained forks, AG Grid, or TanStack Table + Virtual — before building on it. Flagged, not blocking: capability 3's just-in-time research exists precisely for this.

### ADR 0002 + 0004 — storage and materialization (reaffirmed, one improvement)

Re-verified: indexes are still schema-file-only; the dashboard can only view them ([indexes docs](https://docs.convex.dev/database/reading-data/indexes/)). The sidecar design remains necessary and correct.

**New since the ADRs were drafted: staged indexes** — `staged: true` in the schema backfills asynchronously without blocking the deploy, monitored in the dashboard, enabled by a follow-up deploy. This directly softens ADR 0004's stated consequence ("index backfill on huge tables takes time"). The materialization flow should become: deploy with staged index → monitor backfill → flip to enabled → switch the repository's query path → drop sidecar rows. This is an **amendment to ADR 0004, not a supersession** — the decision (admin-triggered, zero data movement) is untouched; one mechanism improves.

### ADR 0003 / 0005 — reaffirmed without qualification

Validated-JSON-artifacts-as-the-agent-surface is now the mainstream pattern (Convex itself shipped AI Context Files in March 2026). The GlideOS competitive read also held up: it reached **beta on 2026-06-04** ([announcement](https://community.glideapps.com/t/introducing-glideos/87253)), closed-source, no code export, credit-priced — the differentiation thesis (open artifacts + tested output) is intact and the window is open.

## Issue #2 conventions, re-scrutinized

- **ESM-only, strict TS** — unambiguous, keep.
- **npm workspaces** — still the defensible conservative pick (Node 24 LTS bundles npm 11; no credible 2026 source calls npm workspaces wrong at this scale). pnpm 11 is the community monorepo consensus; the switch is cheapest before `packages/*` exists (capability 2). Verdict: keep npm; revisit only if workspace pain appears — not worth churn now.
- **Vitest 4** — current stable (4.1.x; v5 is beta). Keep; don't chase the beta.
- **ESLint 10 + typescript-eslint + Prettier** — still the right call for this repo specifically. The 2026 field is tri-modal: ESLint (complete, slow), oxlint+tsgolint (59/61 type-aware rules at ~10x speed, but **requires TypeScript 7** — the repo pins ~5.9), Biome 2.5 (fast, but no Vitest-matcher rules and non-parity type inference). The deciding argument from capability-1 research — `vitest/no-restricted-matchers` making the snapshot/`toBeDefined` ban machine-enforced — survives. Revisit when TS 7 becomes the repo's compiler.
- **100% line coverage as floor, CI as gate, committed + drift-checked codegen** — _more_ valid in 2026, not less: these are machine-checkable invariants, and machine-checkable invariants are exactly what scales with agent throughput. The reference repo's own gap (CI publishing without tests) is the cautionary tale.

## The three-step workflow (research → spec → plan)

**Verdict: keep it — the industry converged on this exact shape after feather-testing adopted it.** Amazon Kiro (GA ~March 2026) structures every feature as requirements → design → tasks; GitHub [spec-kit](https://github.com/github/spec-kit) (~119k stars, 30+ agent integrations) is the same three-artifact idea. This workflow is not a relic of the manual era; it is the direction the field moved. Thoughtworks still rates spec-driven development ["Assess"](https://www.thoughtworks.com/radar/techniques/spec-driven-development) with a warning against heavy up-front specs — which argues for right-sizing, not abandonment.

What each artifact buys in an agent-first loop, from first principles:

1. **1_research.md — keep; its purpose changed.** Its value is no longer teaching the executor; it is **verifying external reality against live sources**, because model training data is always stale. Proof from this repo: capability-1 research caught that the library's own README shows `environmentMatchGlobs`, which Vitest 4 removed — an agent implementing from memory or from the README would have shipped a broken config. Cost collapsed (agents write it in minutes); value didn't.
2. **2_spec.md (test matrix) — keep; least dispensable.** The human-defines/agent-fills matrix is the repo's highest-leverage human input and is machine-checkable (row count == test count). It is also the product's own moat (100% tested artifacts) applied to the product's development. Dropping it would contradict the vision doc.
3. **3_plan.md — keep, but lean.** For a strong 2026 model this is the weakest artifact as _prose_; its real value is as a **cross-session state ledger**: verification gates with negative checks (capability 1's G6–G8 pattern is excellent), version pins, and a deviation log. Gates and pins, not narrative.

**Right-sizing amendments** (the actual reform this review proposes):

- **Scale artifacts to risk.** Three files for capabilities carrying architectural risk (2, 6, 8, 9). For small or mechanical capabilities, one combined `research-spec-plan.md` is acceptable — the test matrix section is the only non-negotiable part.
- **Exactly one human gate.** Docs posted → owner approves → implementation runs unattended to green CI. Not three sequential approvals; the cost has moved from writing to reviewing, so spend the review budget where leverage is: read the test matrix closely, skim research for verdicts, spot-check plan gates.
- **Plans are living documents** during execution (record pin substitutions and spec deviations in place, as capability 1's plan already mandates).

## Actions

1. Amend ADR 0004 with the staged-index mechanism (note, not supersession).
2. Amend `docs/capabilities/README.md` with the right-sizing rules above.
3. Proceed with issue #2 as planned — the scaffold docs survive this review unchanged.
4. Capability 3's research step must re-evaluate the grid library (Glide Data Grid is ~2.5 years unmaintained on npm).
5. Deferred watches: TanStack DB × Convex collection (adopt only when official), oxlint type-aware (when the repo moves to TS 7), `@convex-dev/workflow` 1.0 (pin exactly until then), pnpm (only if npm workspace pain materializes).
