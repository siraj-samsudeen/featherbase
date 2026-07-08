# Open-Source App Builders & Workflow Tools Survey

> **Provenance:** research agent report, 2026-07-08. Licensing verified against primary sources. Preserved verbatim. Post-pivot note: since Featherbase is a TypeScript rewrite (not a Python fork), **Activepieces (MIT, TypeScript) is directly code-borrowable** and Baserow (MIT, Python) demotes to design reference — inverting the report's original Python-oriented ranking.

---

# Open-Source App Builders & Workflow Tools — Research Report for Frappe-Based Workflow Features

*Research current as of July 2026. Licensing verified against primary sources (LICENSE files / official announcements) because the host project is MIT and code-borrowing viability depends on it.*

---

## 1. Budibase

**What it is.** A low-code platform for building internal business apps (forms, admin panels, approval apps) on top of internal data (its own DB, SQL sources, REST), with a built-in automation engine. Aimed at IT teams and ops engineers who want CRUD apps plus attached automations without writing a full stack.

**Workflow architecture.** Each automation has exactly **one trigger** (row saved/updated/deleted, webhook, cron, app action) detected via an event emitter, filtered against automation definitions, and pushed as a job onto a **Bull.js queue backed by Redis** (an `InMemoryQueue` stands in during dev). A background **worker thread** runs an `Orchestrator` class that walks `automation.definition.steps` sequentially, resolving **Handlebars or JavaScript bindings** per step against a shared `AutomationContext` (step outputs are stored in context keyed by `stepId`/`name`/`id`). Custom JS runs in an **isolated-vm sandbox** with memory/CPU limits. **Branching** is first-match: branch steps evaluate condition queries against the context; only the first matching branch runs; branches can fan out from any step. **Looping** (`LOOP_V2`) iterates arrays/strings with max-iteration guards, failure conditions, and result summarization. Testing/replay: `externalTrigger` invokes an automation with mock data; test results persist and progress streams to the builder in real time. The editor is a **vertical linear chain** of steps with branch fan-out — not a free canvas.

**License.** **Open-core, copyleft:** core server/builder **GPL v3**; client and component libraries **MPL 2.0** (so built apps are freely licensable); paid "pro" packages under the **Business Source License**. → **Code cannot be copied into an MIT project** (GPL is incompatible with MIT distribution); ideas only.

**Worth borrowing (ideas).**
1. The **`AutomationContext` + binding-resolution pattern** — step inputs are templates resolved against accumulated step outputs; this maps almost 1:1 onto Frappe's Jinja/`frappe.render_template` and would feel native.
2. **Event-emitter → filter → queue producer/consumer split** — mirrors Frappe's doc_events + RQ; a clean seam for a Frappe implementation.
3. The **loop-step safety rails** (max iterations, failure condition, summarize-vs-full results) — cheap to implement, prevents the worst user footguns.

**Avoid.** Their licensing-quota checks are threaded through the execution path (`processEvent` wrapped in quota enforcement) — entangling billing with the engine core makes the engine hard to extract or reason about.

---

## 2. NocoDB

**What it is.** An Airtable-style smart spreadsheet that layers grid/kanban/form/gallery views over new or **existing** MySQL/Postgres (now Oracle) databases. Aimed at teams who want an Airtable UX on databases they already own. Very active (63.8k stars; monthly `2026.x` releases).

**Workflow architecture.** Three automation layers: **Webhooks** (v3: unified after-insert/update/delete events, bulk-consolidated), **Scripts** (JavaScript with a full data API, Airtable-script-like), and **Workflows** (beta visual builder). Workflows have **eight trigger types** — manual, scheduled, record created/updated/deleted, form submission, record-enters-view, and condition-matched — plus record actions (create/update/find/list/delete), communication actions (email, Slack), and **flow nodes**: If/else branching and an **Iterate node** for arrays. Execution is strictly sequential: "Trigger fires → actions execute top-to-bottom → flow nodes control branching/repetition → logs are recorded for auditing." Editor is a node-based visual flow. Notably, **Workflows and Scripts are paid features** — cloud plans or self-hosted **Business plan and above**; not in the free self-hosted build.

**License.** **Relicensed January 2026** (v0.301.0+, GitHub discussion #12891): from **AGPL-3.0** to a **"Sustainable Use License"** — source-available, BUSL-like, internal-business/non-commercial use only. It is **no longer open source** by OSI standards. Pre-0.301.0 code remains AGPL-3.0 (still incompatible with MIT). → **No code borrowing, either era.**

**Worth borrowing (ideas).**
1. **"Record enters view" and "condition matched" triggers** — triggering when a row *starts matching a saved filter* is the single most Glide/Airtable-native trigger concept, and maps beautifully onto Frappe's filter/report metadata.
2. The **webhook v3 event unification** (single vs bulk operations collapsed into one event shape) — Frappe's doc_events fire per-doc; a bulk-aware envelope is worth designing in early.
3. The three-tier ladder **webhooks → scripts → visual workflows** as a coherent escalation of power.

**Avoid.** The relicensing whiplash (MIT-adjacent → AGPL → source-available) and paywalling of the entire workflow feature fractured community trust — a cautionary tale, and it also means NocoDB is unusable even as an upstream dependency.

---

## 3. Baserow

**What it is.** An open-source Airtable alternative (Django/Python backend, Vue/Nuxt frontend) with databases, views, a dashboard builder, an application builder, and — since **Baserow 2.0** — native workflow automations. Aimed at no-code teams and self-hosters; open-core with a genuinely functional free core.

**Workflow architecture.** Hierarchy: **Automation (container) → Workflow (node sequence) → Node (trigger or action)**. Every workflow starts with one trigger (rows created/updated, schedule, incoming webhook) followed by sequential actions. **Router nodes** provide conditional paths using Baserow's formula language (e.g., `priority = "High" and due_date = today()`); **Iterator nodes** loop over rows/arrays and are **nestable**, with run history that drills down into individual iterations. Data passes between steps via formulas/variables. Lifecycle: **Draft → Test run (against live data) → Published** (always-on). Run history shows per-node success/failure counts, timing, credits consumed, and error messages. Editor: vertical node chain — "+" node selector, drag-to-reorder, right-hand configuration sidebar. Cloud plans meter execution via **automation credits** (2k free → 2M enterprise); self-hosted open source is unrestricted.

**License.** **MIT (Expat) core**, verified in the LICENSE file: everything is MIT **except** `premium/` and `enterprise/` (proprietary source-available) and `docs/` (CC BY-SA 4.0). Crucially, the automation engine lives at **`backend/src/baserow/contrib/automation`** — inside the MIT core, alongside `builder`, `dashboard`, `database`. → **Code is legally borrowable into an MIT project, and it's Python.**

**Worth borrowing (ideas *and code*).**
1. **The entire automation contrib module** — an MIT-licensed, Django-based trigger/action/router/iterator engine with node models, serializers, and run-history schema. The closest thing in existence to "a workflow engine already written for a Python metadata framework"; its node table design translates directly to Frappe DocTypes.
2. **Draft / test-run / published lifecycle** — the cleanest publishing model of the eight; exactly what a Glide-like product needs so users can iterate safely.
3. **Iterator drill-down run history** (inspect each iteration of nested loops) — superb debugging UX for non-programmers.

**Avoid.** The **automation-credits metering** concept — it's a SaaS monetization artifact that adds engine complexity and user anxiety; irrelevant for a self-hosted Frappe fork. Also note the engine is young (2.0-era beta): sequential-only, router picks one path, no parallel branches — design your schema so parallelism can be added later.

---

## 4. Appsmith

**What it is.** A developer-oriented internal-tool builder: drag-and-drop UI widgets bound to queries against 25+ databases/APIs, with JavaScript everywhere. Java (Spring) backend + React frontend + MongoDB. Aimed at engineering teams building admin panels/dashboards.

**Workflow architecture.** Appsmith Workflows are **code-first, not visual**: you write JavaScript functions in a workflow editor and orchestrate queries/services in code. Triggers: **webhooks**, invocation **from Appsmith apps** (integrated datasource), and **scheduled cron jobs**. Execution is backed by **Temporal** (durable execution; workflow metadata/state in PostgreSQL), giving reliable long-running processes; run history is tracked for debugging. Human-in-the-loop approvals are marketed but were still "coming soon" in docs. **Workflows are a Business-tier (paid) feature** — not present in the open-source Community Edition at all.

**License.** Core: **Apache 2.0** (permissive, MIT-compatible — Apache-2.0 code *can* be incorporated into an MIT-hosted project with NOTICE preservation). But the workflows product itself is commercial/EE, so the interesting code isn't in the Apache part.

**Worth borrowing (ideas).**
1. **Durable-execution semantics as a north star** — Temporal's model (deterministic replay, resumable long-running workflows) is the right *mental* framework for "what does a paused approval workflow mean," even if you implement it lightly on RQ.
2. **"Trigger workflow from an app action"** as a first-class trigger — Glide-like products live on button-triggered workflows; Appsmith treats app→workflow invocation as a typed, documented interface.
3. JS-function-as-workflow is a good **escape hatch tier** above visual flows (analogous to Frappe Server Scripts).

**Avoid.** Taking on **Temporal as an operational dependency** — a whole cluster + datastore for workflow state is wildly heavy for a Frappe deployment; and Appsmith's choice to keep workflows entirely out of the open edition means there's no reference implementation to read anyway.

---

## 5. ToolJet

**What it is.** An internal-tool builder (NestJS backend, React frontend, built-in "ToolJetDB" on Postgres) that has repositioned around AI app generation, with a distinct **Workflows** product alongside the app builder. Aimed at teams building CRUD apps + background automation in one platform.

**Workflow architecture.** Workflows are built on a **true free-form canvas** (node graph, ReactFlow-style) — the only tool here besides n8n with a real 2-D canvas. Triggers: **app-triggered** (button/form in a ToolJet app), **webhook**, **scheduler**. Node types: data nodes (ToolJetDB and datasource queries), **RunJS** (custom JavaScript), logic nodes (**If-Else**, **Loop** over datasets), and **Response** terminal nodes that define the workflow's return value (workflows are callable like functions from apps). Execution has configurable **timeout and memory limits via environment variables**; a logs panel shows per-node execution details. Free/self-hosted editions have workflow count/execution limits; heavier use is paid.

**License.** **AGPL-3.0** for the core repo (verified: full AGPL text, changed from GPLv3 explicitly to close the SaaS loophole), plus a commercial **`ee/`** directory for Enterprise Edition features. → **No code borrowing into MIT.**

**Worth borrowing (ideas).**
1. **Workflows-as-callable-functions** — the Response node makes a workflow an RPC endpoint that apps invoke synchronously and use the return value. For a Frappe fork this is a killer pattern: a workflow doubles as a whitelisted API method a Desk button can call.
2. The **app-trigger contract** (button click → workflow with typed params) — the clearest implementation of the Glide "button runs workflow" experience.
3. Simple **env-var-based execution guardrails** (timeout/memory) — pragmatic and low-machinery.

**Avoid.** The free-form canvas paired with a comparatively shallow durability story (no queue/retry/replay depth like n8n/Windmill) — canvas generality without engine depth gives users rope without a net.

---

## 6. n8n

**What it is.** The reference node-based workflow automation tool (TypeScript/Node.js, Vue 3 editor): 400+ integration nodes, huge community, heavily AI-agent-focused since 2025. Aimed at technical automators; the benchmark for canvas-style automation UX.

**Workflow architecture.** Workflows are **JSON graphs of nodes + connections** edited on a **free-form canvas**. The core data model: data flows between nodes as **arrays of items**, and every node implicitly processes all incoming items (built-in mapping without explicit loops). Branching via **IF / Switch** nodes (multiple output connectors); merging via Merge node; explicit loops via **Loop Over Items (Split in Batches)**; sub-workflows via Execute Workflow. Execution engine: single-process by default; **queue mode** for scale — main instance enqueues execution IDs into **Redis (BullMQ)**, worker instances pull and run them, with dedicated webhook processors; task runners isolate user JS code. Benchmark ~72 req/s in queue mode; real deployments report 10k+ executions/day on three workers. Error handling: **per-node retry-on-fail**, per-workflow **error workflows** (a second workflow triggered on failure), full execution logs with every node's input/output, **pinned data** for deterministic re-runs, and partial replay from a step.

**License.** **Fair-code, NOT open source**: the **Sustainable Use License** (internal business use only; no reselling/hosting as a service) plus an **n8n Enterprise License** for `.ee.`-marked files. Historically Apache 2.0 + Commons Clause (also not OSI). → **No code borrowing, period** — and be careful even about close paraphrase of its source.

**Worth borrowing (ideas).**
1. **Items-array data flow with an expression language over prior nodes** (`$json`, `$node["X"].json`) — implicit iteration over rows is exactly the semantics a table-centric Frappe workflow wants (trigger yields N rows → each step maps over them).
2. **Error workflows** — routing failures to a user-defined workflow (notify, compensate) instead of burying them in logs; trivially expressible in a trigger-action model.
3. **Pinned data + partial replay** — the gold standard for workflow debugging; pin a trigger payload once, iterate on downstream steps without re-firing real events.

**Avoid.** The license, obviously — but also the **full free-canvas + multi-item merge semantics** for a Glide-like audience: n8n's Merge-node/multiple-input reasoning is a notorious learning cliff. Glide's linear chain exists precisely to avoid it.

---

## 7. Windmill

**What it is.** A developer platform that turns **scripts (Python, TypeScript, Go, PHP, Bash, SQL) into webhooks, workflows, and UIs** — "code-as-step" workflow engine (Rust backend, Svelte frontend) claiming 13x Airflow performance; open-source alternative to Retool + Temporal. Aimed at platform/infra engineers.

**Workflow architecture.** A flow is a **DAG stored in the OpenFlow format** (an open, JSON-serializable spec). **Every step is an individual job** pushed to a **Postgres-backed job queue**; workers pull jobs, so sequential steps chain while parallel branches are consumed by different workers concurrently. Control flow: **branch-one** (first true condition) and **branch-all** (parallel execution), **for-loops** (iterate an embedded sub-flow over a dynamically computed list, with parallelism) and **while loops**. Reliability: per-step **retries** (constant/exponential), **error handlers**, early stop/early return, step result **caching**, concurrency limits, custom timeouts, **step mocking**. Its signature feature: **Suspend & Approval** — any step can suspend the flow at zero cost until resume endpoints are hit; approvers get **secret resume URLs**/an approval page (with forms and slack/email delivery). Editor: **structured top-down DAG** (not free-form) with per-step config panels and collapsible flow groups; the YAML/JSON is always accessible and editable.

**License.** Mixed, per the LICENSE file: `backend/` + `frontend/` **AGPLv3** (with proprietary enterprise snippets behind a compile flag); language **clients** (`python-client/`, `deno-client/`, `go-client/`, etc.) and — importantly — the **OpenFlow and OpenAPI specification files** are **Apache 2.0**. → **Engine code not borrowable (AGPL); the OpenFlow spec IS borrowable (Apache 2.0).**

**Worth borrowing (ideas + the spec).**
1. **Adopt/adapt the OpenFlow spec** (Apache 2.0) as the serialization format for flow definitions — an open, battle-tested schema for steps, input transforms, branches, loops, retries; storing it in a Frappe DocType JSON field gives portability for free.
2. **Suspend/approval via signed resume URLs** — the best human-in-the-loop design in this survey, and a natural upgrade path for Frappe's existing Workflow (state-machine) approvals: an email link that resumes a paused flow.
3. **Every-step-is-a-queued-job** — maps directly onto Frappe's RQ: each step enqueued individually buys you per-step retry, logging, and parallel branches almost for free.

**Avoid.** The **multi-language worker fleet** (generic workers that can execute six languages with dependency resolution) — enormously powerful, enormously complex; a Frappe fork needs exactly one step runtime (restricted Python + whitelisted actions).

---

## 8. Activepieces

**What it is.** An open-source Zapier alternative (TypeScript monorepo: Node.js backend, React flow builder) whose defining asset is the **pieces framework** — type-safe TypeScript connectors published as npm packages (~280–400+, ~60% community-contributed), which since 2025 also double as **MCP servers for AI agents**. Aimed at non-technical automators, with developers extending via pieces. Very active (v0.85.x, June 2026).

**Workflow architecture.** A flow = **one trigger + a chain of actions**, edited in a **vertical, Zapier-style linear chain** (rendered on a canvas but structurally a top-down tree) with **branches (router)** and **loops** nested inside the chain; flows are **versioned with draft/published** states. Trigger types: webhook, schedule/cron, and app events, with polling and webhook **trigger strategies** abstracted by the pieces framework (including dedup and test-data sampling). Execution: everything is **queue-backed on Redis/BullMQ** — webhooks and recurring jobs land in Redis; **workers** poll jobs, allocate a **sandbox** (isolated process, resource limits, WebSocket link), inside which the **engine** parses the flow JSON and executes step by step. Auto-retries, crash recovery ("a spike does not drop work — it queues and drains"), and per-run logs with step inputs/outputs. Scales horizontally by adding workers.

**License.** **MIT** for the Community Edition (verified in README), with enterprise features confined to **`packages/ee/` under a commercial license**. Pieces themselves are MIT npm packages. → **Code is borrowable into an MIT project** (TypeScript, so mostly for the builder UI and connector-framework design; server is Node not Python).

**Worth borrowing (ideas *and code*).**
1. **The pieces framework design** — declarative `createPiece`/`createAction`/`createTrigger` with typed props, auth definitions, and pluggable polling/webhook strategies. This is the blueprint for a Frappe "connector DocType + Python decorator" framework, and the MIT license means you can lift schemas and even UI code.
2. **App ↔ Worker ↔ Sandbox ↔ Engine separation** — the flow-interpreter ("engine") is a standalone artifact that takes flow JSON + context and returns results; making your executor a pure function of (definition, trigger payload) is what makes testing and replay tractable.
3. **The linear-chain editor UX** — of all eight, Activepieces' builder is the closest to Glide Workflows' feel (vertical steps, inline branch/loop nesting, step test panel with sample data). Its React flow-builder code is MIT.

**Avoid.** Reimplementing their **per-execution OS sandbox machinery** — necessary for untrusted multi-tenant npm code, unnecessary for a Frappe fork where steps are your own whitelisted actions plus Frappe's existing restricted-Python server scripts.

---

## Comparison Table

| Project | License (precise) | Workflow model | Editor style | Best-borrowable idea |
|---|---|---|---|---|
| **Budibase** | GPL v3 core; MPL 2.0 client libs; BSL pro packages — *ideas only* | 1 trigger → sequential steps; first-match branches; LOOP_V2; Bull/Redis queue + worker-thread orchestrator | Vertical chain w/ branch fan-out | `AutomationContext` + Handlebars/JS binding resolution per step |
| **NocoDB** | **Sustainable Use License** (since Jan 2026, v0.301.0+; formerly AGPL-3.0) — *not open source; no borrowing* | Webhooks + JS Scripts + visual Workflows (beta, paid tier); 8 triggers; if/else + iterate nodes; sequential | Node-based visual flow | "Record enters view / condition matched" trigger type |
| **Baserow** | **MIT core** (automation module included); premium/ & enterprise/ proprietary; docs CC BY-SA — *code borrowable* | Automation → Workflow → Nodes; trigger + sequential actions; Router (formula conditions); nestable Iterators; draft/test/publish | Vertical node chain + right sidebar config | The MIT-licensed Django automation module itself + draft/test-run/publish lifecycle |
| **Appsmith** | Apache 2.0 core, but Workflows are commercial Business-tier — *engine not in OSS part* | Code-first JS workflows; webhook/cron/app triggers; Temporal-backed durable execution | Code editor (not visual) | App-action → workflow invocation as a typed, first-class trigger |
| **ToolJet** | AGPL-3.0 + commercial `ee/` — *ideas only* | Canvas graph; app/webhook/schedule triggers; query, RunJS, If-Else, Loop, Response nodes; env-var timeouts | Free-form canvas (ReactFlow-style) | Workflows-as-callable-functions (Response node returns value to app) |
| **n8n** | **Sustainable Use License** + Enterprise License (`.ee.` files); fair-code, **not OSI** — *no borrowing* | JSON node graph; items-array data flow; IF/Switch/Merge; Loop Over Items; queue mode (Redis/BullMQ workers); error workflows | Free-form canvas | Pinned data + partial replay; error workflows |
| **Windmill** | AGPLv3 core + proprietary EE snippets; **clients & OpenFlow spec Apache 2.0** — *spec borrowable, code not* | OpenFlow DAG; every step = queued job (Postgres queue, Rust workers); branch-one/branch-all; for/while loops; retries, error handlers, suspend/approval | Structured top-down DAG + step panels | OpenFlow serialization spec (Apache 2.0) + suspend/approval with signed resume URLs |
| **Activepieces** | **MIT** CE + commercial `packages/ee/` — *code borrowable* | 1 trigger + linear action chain w/ nested router/loops; Redis/BullMQ; worker→sandbox→engine execution; versioned flows | Vertical Zapier-style chain | Type-safe pieces/connector framework (declarative actions/triggers/auth/polling strategies) |

---

## Synthesis: Top 3 References for a Frappe-Based Visual Workflow Engine

**1. Baserow — the structural blueprint (and legal code source).** It is the only project where a real trigger/action/router/iterator engine ships **MIT-licensed, in Python, inside a metadata-driven Airtable-like framework** — i.e., the same problem shape as Frappe. Its `contrib/automation` module (node models, per-node run history, draft/test-run/publish lifecycle) can be studied line-by-line and legally adapted; its Automation→Workflow→Node hierarchy translates directly to DocTypes, and its formula-based Router mirrors what Frappe filters/Jinja already provide. Start here for the data model and lifecycle.

**2. Activepieces — the connector framework and the Glide-like UX.** MIT-licensed and closest in spirit to Glide Workflows: one trigger, a vertical chain, branches and loops nested inline, per-step test data. Two things generalize beyond its Node stack: the **declarative pieces framework** (typed actions/triggers/auth, pluggable polling/webhook strategies with dedup) — the model for how third-party Frappe apps should contribute workflow steps via hooks — and the **engine-as-pure-interpreter** separation (flow JSON + payload in, results out), which is what makes replay and testing cheap. Its React builder UI is also MIT if the Desk frontend wants to lift patterns directly.

**3. Windmill — the execution-engine semantics (ideas + an Apache-licensed spec).** The AGPL code is off-limits, but Windmill contributes the two hardest design answers: (a) **every step is an individually queued job** — which maps perfectly onto Frappe's existing Redis/RQ infrastructure and yields per-step retries, logs, parallel branches, and resumability without a bespoke scheduler; and (b) **suspend/approval via secret resume URLs**, the cleanest human-in-the-loop primitive, and a natural evolution of Frappe's existing state-machine Workflow doctype. Its **OpenFlow spec is Apache 2.0**, so the flow-definition schema itself can be adopted outright for portability.

**Runner-up:** Budibase is architecturally the *most Frappe-like implementation* (events → Redis queue → orchestrator with template bindings and an accumulated context), and worth reading as a design document — but GPLv3 keeps it strictly ideas-only. n8n remains the UX/debugging benchmark (pinned data, partial replay, error workflows) — copy the concepts, never the code. And treat NocoDB's January 2026 relicense as the survey's cautionary tale: for an MIT host project, license diligence isn't pedantry — three of the eight "open" projects here (n8n, NocoDB, and effectively Appsmith Workflows) have their workflow engines outside OSI-open licensing entirely.

**Sources:** [Budibase automation architecture (DeepWiki)](https://deepwiki.com/Budibase/budibase/4.1-automation-architecture), [Budibase branching docs](https://docs.budibase.com/docs/branching), [Budibase GitHub](https://github.com/Budibase/budibase), [NocoDB workflow docs](https://nocodb.com/docs/product-docs/automation/workflow), [NocoDB relicense discussion #12891](https://github.com/nocodb/nocodb/discussions/12891), [NocoDB GitHub](https://github.com/nocodb/nocodb), [Baserow workflow automation docs](https://baserow.io/user-docs/workflow-automation), [Baserow LICENSE](https://github.com/baserow/baserow/blob/develop/LICENSE), [Baserow contrib tree](https://github.com/baserow/baserow/tree/develop/backend/src/baserow/contrib), [Baserow 2.0 release notes](https://baserow.io/blog/baserow-2-0-release-notes), [Appsmith workflows docs](https://docs.appsmith.com/workflows), [Appsmith GitHub](https://github.com/appsmithorg/appsmith), [ToolJet workflows docs](https://docs.tooljet.ai/docs/workflows/overview), [ToolJet LICENSE](https://github.com/ToolJet/ToolJet/blob/develop/LICENSE), [ToolJet AGPL announcement](https://blog.tooljet.com/changing-license-to-agpl/), [n8n queue mode docs](https://docs.n8n.io/hosting/scaling/queue-mode/), [n8n Sustainable Use License](https://docs.n8n.io/sustainable-use-license/), [n8n deep dive (Jimmy Song)](https://jimmysong.io/blog/n8n-deep-dive/), [Windmill flow architecture](https://www.windmill.dev/docs/flows/architecture), [Windmill approvals](https://www.windmill.dev/docs/flows/flow_approval), [Windmill LICENSE](https://github.com/windmill-labs/windmill/blob/main/LICENSE), [Activepieces architecture overview](https://www.activepieces.com/docs/install/architecture/overview), [Activepieces GitHub](https://github.com/activepieces/activepieces).
