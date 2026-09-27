# Gate 2 — rubric and acceptance design (proposed)

## Approval and delivery state

The owner approved the Gate-1 product specification with “Yes” in the manager conversation on 2026-09-27: https://ampcode.com/threads/T-01a0e343-28c4-7766-a26d-d0ecb1f5dfd0 . The original Gate-1 draft remains unchanged as the approved text. This document proposes Gate 2; it is not approved. No acceptance code, application code, worker, database, or deployment has been created for this benchmark.

Approval of this document authorizes only Gate 3: implement and validate the external acceptance suite, present the evidence, then stop. Worker launch still requires explicit Gate-3 approval. The behavioral authority is specs/todo/spec.md. This design operationalizes it, without changing it.

## 1. Scoring and elimination

Report acceptance status separately from a weighted score. Each category receives 0–4 with evidence references: 0 = absent or fundamentally broken; 1 = substantial unresolved problems; 2 = works with material friction or gaps; 3 = meets expectations reproducibly; 4 = meets expectations with demonstrated, unusually strong guardrails or clarity. Category-specific evidence below determines the rating; no extra features earn points. Weighted points equal weight × rating / 4. Weights total 100.

| Category | Weight | Evidence and rating focus |
| --- | ---: | --- |
| Correctness and guardrails | 22 | External acceptance outcomes; atomic conflict rejection; invalid writes preserve state; fault recovery; useful worker tests that catch plausible defects. A known data-loss or silent-overwrite defect cannot be offset by another category. |
| Agent success and predictability | 15 | First external submission versus corrected result; correction rounds; independent reproduction; errors caught before submission versus escaped errors; amount and specificity of manager intervention. Self-reports alone do not earn a high rating. |
| Contract quality | 10 | Discoverability, complete schemas and failure/precondition semantics, actual response validation, ordinary HTTP interoperability, and resistance to contract drift. Generated and handwritten contracts can both score well. |
| Migration behavior | 10 | Fresh initialization, rerun, competing invocations, induced failure/retry, preserved data, and credible documented recovery. R1 evidence only; reserve additive rollout/rollback judgment for R2. |
| Custom-code clarity | 8 | Can a reviewer locate and understand title, conflict, and failure policy as ordinary code? Traceability and explicit error handling, not a preferred file count, programming style, or architecture. R1 provides limited evidence about future custom operations. |
| Frontend accessibility and resilience | 10 | Keyboard, semantics, focus, errors, retained drafts, representative widths/zoom, screen-reader evidence, and useful recovery. Visual polish beyond usability earns no bonus. |
| Operational behavior | 8 | Reproducible production build/run, truthful readiness, external stop/restart, DB outage outcomes, process/resource cleanup, useful redacted diagnostics; no deployment required. |
| Implementation complexity | 7 | Human-authored concepts, duplicated policy, dependencies actually needed, handwritten glue, and unusual workarounds. Raw lines/dependency count inform inspection, never determine the score alone. |
| Iteration speed | 5 | Comparable install/build/check/test/start timings, correction-cycle timing, and documented cache/environment conditions. No raw request-throughput benchmark. |
| Future extraction suitability | 5 | Concrete repetition and clean boundaries between repeated operations and domain policy in delivered code. Mark R1 assessment provisional; no reward for speculative abstractions or implementing a framework early. |

For every score, report measured facts separately from reviewer judgment and confidence. Unavailable evidence is “not measured,” never zero or an invented value. If a category cannot responsibly be rated, show its score as pending and the available subtotal out of the assessed weight; do not rescale or rank incomplete totals as equivalent.

Each required acceptance scenario is pass/fail/blocked/not assessed, with its reason and artifact. Retain first-pass results and final verified results. A transient infrastructure failure is not a candidate defect until reproduced or localized.

After R1, recommend elimination only for a demonstrated hard correctness, reproducibility, or framework-support blocker remaining after a documented repair opportunity. Examples: persistent silent overwrite/data loss, inability to reproduce from the lockfiles and commands, or inability to meet the PostgreSQL/external-contract requirements without abandoning the assigned stack. A single first-pass failure is not automatic elimination. Give each candidate one initial feedback round and one verification round; unresolved blockers receive explicit investigation rather than automatic extra point penalties or silent exclusion. Any further effort is reported for owner review. Speed, code size, unfamiliarity, or score rank alone do not eliminate. The owner reviews the comparison before advancement.

## 2. Release-1 external acceptance inventory

Every row below maps to the named requirements in specs/todo/spec.md. Parameterized cases remain separate results rather than a single all-or-nothing mega-test. Tests assert unrelated records remain unchanged where relevant.

| ID | Black-box scenario and decisive assertions |
| --- | --- |
| UI-01 | Empty collection: no sign-in; All selected; empty state differs from loading/error; create is usable. |
| UI-02 | Create `Buy milk`: exactly one open record; normalized title; success and cleared create field; independent HTTP read confirms it. Delayed request plus repeated activation produces one record. |
| UI-03 | Two deliberately completed submissions with the same title produce distinct IDs; deleting one leaves exactly one. No ordering assumption. |
| UI-04 | Rename open and completed records: same identity, correct new title, original completion state, unrelated record unchanged. |
| UI-05 | Complete and reopen: correct state through UI and independent HTTP read; item enters/leaves the active filtered view. |
| UI-06 | Delete open and completed records: absent in every filter and direct read, still absent after reload. |
| UI-07 | Three asymmetric records (two open, one completed): exact memberships for All/Open/Completed; filtering changes no data; complete last open item and verify filtered empty state. |
| VAL-01 | Create and rename: surrounding ASCII and Unicode White_Space trimmed, internal double spaces/case/composed and decomposed Unicode preserved. Explicit expected strings, not the application's normalization code. |
| VAL-02 | Empty/whitespace-only, 201 code points, internal newline: rejected and draft preserved. Exactly 1 and 200 code points accepted, including astral characters that distinguish code points from UTF-16 length. Verify normalized-length boundaries. Native single-line controls may prevent newline entry; direct HTTP still must reject it. |
| VAL-03 | Markup title renders literally; no script/dialog/event-handler execution. |
| DUR-01 | Mixed renamed/open/completed/deleted records survive reload and a new isolated browser context with no transferred browser storage. |
| DUR-02 | Same mixed dataset survives graceful application stop/start and forced application-process termination after acknowledged writes; PostgreSQL stays running. IDs and all observable values match the pre-stop snapshot. |
| FAIL-01 | Abort create/rename before upstream delivery; preserve exact draft; error announced; retry succeeds once without retyping. Count requests and stored records to detect hidden retries/duplicates. |
| FAIL-02 | Definitively reject complete/reopen/delete; confirmed state retained/restored; usable recovery; retry changes only the intended record. |
| FAIL-03 | Fail initial and subsequent list loads: error, not false empty state; recover without full-page reload; previously shown data is not presented as freshly confirmed. |
| FAIL-04 | Forward creation to the real application, confirm upstream success, suppress its response to the browser; exercise offered recovery; exactly one record for that submission. Repeat with an unrelated existing duplicate title so title-matching alone cannot pass. |
| CON-01 | Two independent browser contexts observe one record; A renames; B's stale rename is rejected, A's value persists, B's draft survives; B reviews latest and deliberately saves successfully. |
| CON-02 | A renames; B's stale complete, reopen, or delete is rejected (appropriate initial completion state per case). Verify all fields and existence. |
| CON-03 | Direct HTTP race against one observation: exactly one of two valid differing mutations succeeds; loser is conflict; stored result equals winner. A→B→A still invalidates the original observation. |
| CON-04 | A deletes while B edits; B's save/complete/reopen/delete reports absence, never resurrects; recoverable rename draft and reconciled list. |
| A11Y-01 | Keyboard-only create/edit/complete/reopen/filter/delete; logical tab order, visible focus and meaningful destination after removal; no pointer assistance in this scenario. |
| A11Y-02 | Accessible roles/names/states; associated errors; pending/success/conflict/error announcements; automated accessibility scan in empty, populated, editor, validation, and conflict states. Manual screen-reader pass is separately recorded, never inferred from axe or ARIA alone. |
| RESP-01 | Desktop 1280×800, mobile 390×844, narrow 320×800, and 200% text enlargement: long 200-code-point title; controls visible/usable; no overlap or horizontal page overflow. Use geometric/semantic assertions plus inspected captures, not pixel matching. |
| API-01 | Fetch advertised OpenAPI 3.1 document; validate it; bind and call all Todo operations using only its public descriptions/schemas. Check success/domain-error statuses, bodies, headers and concurrency inputs against that document. |
| API-02 | Direct requests bypass UI: malformed JSON, null/numeric/missing title, length/whitespace/line-break violations, invalid filter, and omitted concurrency preconditions. Expect documented client errors, no unhandled 5xx and unchanged records. |
| API-03 | API create/read/list/filter/rename/complete/reopen/delete matches product expectations, including duplicate titles, Unicode normalization, stale observations, and missing records. Independent semantic assertions prevent a permissive OpenAPI schema from masking wrong behavior. |
| MIG-01 | Empty DB initializes; run migrations again with persisted mixed data; exact observable snapshot preserved and no duplication; application never requires reset or reseed. |
| MIG-02 | Deny a required database operation during fresh migration, restore permission, retry; explicit failure followed by successful convergence. Separately interrupt a migration while active where deterministic interception is possible; verify incomplete work is not marked applied. |
| MIG-03 | Two simultaneous migration invocations: both safely converge or one explicitly refuses; subsequent rerun succeeds and preserves data. |
| OPS-01 | Missing required schema: no false readiness. Running DB outage: writes do not claim durable success, drafts survive; restore connectivity and recover. |
| OPS-02 | Production commands from clean checkout/install; readiness; clean stop; no orphan listeners; restart on same DB. Capture diagnostics and elapsed times. |

### Browser matrix and accessibility limits

Run the full browser inventory in Chromium, normally desktop. Repeat core lifecycle/filter flows, retained-input recovery, stale rename, keyboard operation, and long-title layout in Chromium mobile. Run core create/edit/filter flows in Firefox and WebKit at both desktop and mobile widths, including completion to establish mixed filter states. Run direct HTTP, restart, migration, and operational checks separately from browser projects, avoiding three redundant database-fault runs.

Mobile means viewport/touch emulation, not a real iOS/Android device. Text enlargement is a separate check, not a device-pixel-ratio change; Gate 3 must demonstrate that its enlargement method actually increases rendered text, and record differences from browser-native text zoom. Manual screen-reader operation needs an actual screen reader/browser combination; if unavailable in the execution environment, mark that evidence unassessed and arrange an owner-assisted check rather than claim WCAG certification. Automated results alone cannot prove all applicable WCAG 2.2 AA requirements.

## 3. Minimal semantic UI contract

This is a proposed English-language accessibility contract, not a DOM layout/component contract. Exact accessible names below stabilize shared selectors. Titles and action outcomes remain visible. Native HTML semantics or equivalent valid ARIA are acceptable. Styling, element nesting, editor placement, and rendering strategy remain free.

| Surface | Shared contract |
| --- | --- |
| Create | Textbox named `New todo`; button named `Add todo`. |
| Collection | A region named `Todos`; each saved record exposes a group named by its exact saved title, with a checkbox named `Completed`, and buttons `Rename` and `Delete`. Checkbox checked state is authoritative for completion. Duplicate group names are allowed because duplicate titles are valid. |
| Rename editor | Group or dialog named `Rename todo`, one active at a time; textbox `Todo title`; buttons `Save` and `Cancel`. The editor may be inline or elsewhere. Cancel discards the draft without writing. |
| Filter | Group named `Filter todos` containing buttons `All`, `Open`, `Completed`, with exactly one exposed as pressed. |
| Routine feedback | A status live region announces pending and success outcomes; error/conflict/absence uses an alert. Explanatory wording is free except the short visible state phrases below. |
| Empty views | Visible `No todos`, `No open todos`, or `No completed todos`, as appropriate. Never shown as the result of a failed load. |
| Retry | The relevant failure exposes `Retry` for a definitive failure. An ambiguous outcome exposes `Check status` (reconciliation, not blind resubmission). It may lead to a safe `Retry` when non-commit is established. |
| Conflict | Visible `Todo changed`; alert explains it; `Review latest` makes current state available without losing the draft. `Save` becomes a deliberate retry against that reviewed state; `Cancel` discards the draft. No auto-save on review. |
| Deleted elsewhere | Visible `Todo no longer exists`; retained rename text remains selectable/copyable in the editor; `Cancel` dismisses it. No required create-from-draft feature. |
| Optional deletion confirmation | If supplied, dialog named `Delete todo` with `Confirm delete` and `Cancel`. Harness supports either immediate deliberate deletion or this confirmation, without requiring either layout. |

The manager selects records through roles, exact accessible names, and nested roles—not CSS, class names, component knowledge, or test IDs. Duplicate-title tests assert group counts and may act on either identical group, then assert one distinct persisted identity survives; they do not assume ordering. Normal tests use unique, asymmetric titles. Feedback regions are located by role, and field relationships by accessibility semantics.

No requirement is added for tables, cards, routing, client-side caches, optimistic UI, or polling. Gate-2 approval includes these minimal labels and recovery affordances; if they need revision, revise them now, not separately for each candidate after implementation.

## 4. Candidate-independent HTTP and fault testing

OpenAPI paths/envelopes stay unconstrained. Before any candidate runs, freeze the manager's logical operations: list, read, create, rename, complete, reopen, delete, plus each operation's schema/precondition/error assertions. After delivery, the manager supplies thin transport bindings derived solely from the published OpenAPI and public run information. They map logical inputs/outputs to HTTP, including concurrency tokens and pagination if present; they cannot implement missing behavior, swallow errors, invent expected values, access DB rows, or import candidate modules. A generic client cannot reliably infer every operation's meaning from arbitrary OpenAPI alone; these explicit reviewed bindings avoid pretending otherwise.

Record a binding's operation IDs, request/response pointers and status mappings for audit. Validate raw responses before normalization. For any procedural binding necessary beyond data mappings, review its diff as part of the external harness, test it independently, and report the reason. Freeze assertions and scenario inventory at Gate 3; later contract bindings are not permission to weaken them. Any suite correction requires versioned disclosure and reruns for all affected candidates.

UI traffic need not use the advertised JSON API. Discover UI request boundaries from external browser network traces and public run information, not source inspection. Fault rules target the actual action request, and must record a match count and upstream delivery evidence. Prefer Playwright routing for browser-originated requests; use a manager-owned reverse proxy when server rendering, streamed responses, or a different transport prevents reliable interception. Neither path requires candidate test hooks. If a fault cannot be deterministically injected, report that scenario blocked and investigate rather than treating it as passed. No service-worker or rendering strategy is forbidden merely to simplify tests.

Hold a mutation to test pending repeated activation. For lost responses, forward exactly once, verify the committed upstream result, then drop the browser response; subsequent retry/reconciliation traffic is observed. For stale edits, open independent contexts, establish the shared observation, then coordinate requests with explicit barriers. If automatic updates would refresh B, hold B's subsequent inbound updates to preserve its legitimate stale observation; do not fabricate a concurrency token inside browser state. Direct HTTP stale/race tests independently enforce the server contract.

## 5. Fresh isolated PostgreSQL and preserved candidate data

Use one pinned PostgreSQL version/configuration for all six candidates, selected and recorded when building the Gate-3 environment. Each candidate receives a distinct database and non-superuser owner role with a unique secret. No role can connect to another candidate database; remove public database access and verify cross-candidate connection denial. No candidate gets the provisioning credential. Use the same allowed extension policy for all; record any stack-required exception before evaluation rather than quietly granting superuser.

Supply the database exclusively via the externally injected `DATABASE_URL`; wrappers may translate it to idiomatic framework configuration, but all application writes must use that assigned database. A framework-owned hidden database cannot substitute for it. This is a compatibility check, not an assumed blocker for any stack.

Separate three lifetimes:

1. Worker development DB: disposable and isolated from acceptance evidence.
2. Manager test DB: fresh database/role per scenario or tightly coupled scenario group, never shared between independent browser projects. Migrate, start the app, run the group, stop the app, then discard only this explicitly disposable DB. Restart/concurrency/migration groups keep their DB across their own steps.
3. Candidate continuity DB: created fresh for R1, populated through public operations, then retained for R2. Never reset it. Capture a logical dump and externally observable snapshot at R1, verify restoration into a disposable DB, and retain the original DB through R2 and any eventual extraction.

Different candidate orbs need not share a filesystem or loopback network. At Gate 3 validate the manager harness against a provisioned disposable PostgreSQL service accessible from its execution environment; before Gate 4 arrange candidate environments with the same version and isolation policy. Execute acceptance in a clean candidate-local environment when necessary by transferring the immutable manager suite, while retaining manager ownership and preventing access to another candidate. Do not expose databases publicly or put credentials in artifacts. Provisioning and later worker credentials are not created at Gate 2.

## 6. Externally controlled lifecycle

Each candidate supplies public run information: pinned toolchain/lockfiles; argv plus working directory for install, production build, typecheck (or equivalent static checks), its own tests, migrate, and production start; required non-secret configuration; OpenAPI and readiness locations; expected ports and any supporting local services. Readiness output must distinguish usable from not-ready. No common app route is required.

The manager supplies `DATABASE_URL` and an available listen port; `BASE_URL` identifies the resulting externally reachable application for Playwright and HTTP checks. Candidate start commands run in the foreground. A manager supervisor owns the whole process tree and required services; an orb uses its supervised-service mechanism. Stack-native CLIs may be wrapped, but wrappers must forward configuration/signals, expose failures and clean up children, not add product behavior.

Lifecycle: provision disposable DB → install/build if needed → migrate → start → poll declared readiness and independently fetch contract/read collection → run scenarios → stop → verify listener/process exit. A successful readiness response alone is insufficient if the app cannot use the required schema. R1 restart reuses the exact build, config and DB, without reinstalling, rebuilding, resetting, or reseeding. If normal start includes a safe idempotent migration, record and include it in startup time. Forced-termination tests stop application processes only, not PostgreSQL.

Initial harness limits: 120 seconds to readiness for an already built app; 15 seconds graceful shutdown, then forced process-tree termination; bounded UI assertions of 10 seconds, 30 seconds for explicit network recovery. Install/build/migration limits are recorded separately and set generously enough not to confuse compilation with startup. These are harness timeouts, not product latency requirements: timeout results trigger diagnosis and a disclosed rerun with an adjusted limit where justified, never a score-based elimination. An unbounded hang remains a reproducibility/operational issue.

For migration failures use only disposable databases. Gate 3 proves permission-denial injection and an active-migration interruption method against harness fixtures. If a real candidate's migration finishes too quickly to intercept deterministically, do not claim an interruption test passed; retain the permission-failure test and report interruption coverage separately. Snapshot data before/after via public HTTP plus DB-level preservation checks that do not depend on candidate table names. DB checks can inspect catalog/history and dumps for evidence, but cannot replace browser/HTTP assertions or read application internals.

## 7. Measurements and fairness

| Measurement | Capture method and interpretation |
| --- | --- |
| Setup friction | Timestamp each setup attempt, required tools/services, missing prerequisites, official-doc lookups that change setup, manual interventions, and reproducibility from a clean checkout. Separate network/infrastructure failures from stack friction. |
| Agent corrections | Preserve initial submission revision; classify each correction as requirement misunderstanding, API/library misuse, type/build/test failure, runtime/data bug, accessibility issue, contract drift, or environment issue. Record detector, repair attempts, manager guidance and escaped defects. Self-correction and manager-required correction remain distinct. |
| Dependency count | Report direct runtime/dev packages, unique resolved transitive packages, and native/system services separately. Separate browser/backend/tooling and manager harness dependencies; exclude the harness from candidate counts. Include JS and Cargo dependency graphs for mixed stacks; do not pretend package granularity is comparable by a single total. |
| Install/build/typecheck/test | Exact command, exit code, wall time, peak memory where reliably available, toolchain versions and environment. One clean install/build measurement, then three warm repeats with median/range. Keep caches and rebuild invalidation conditions explicit. Do not invent a separate typecheck time when compilation already performs it. |
| Tests | Worker unit/API/DB/browser commands and durations separately from the same external suite duration. Test count is descriptive, not a quality score. Report failures/flakes and all attempts. |
| Agent time/cost | Elapsed work time, correction-cycle elapsed time, and tool/token/cost metrics only if actually available. Separate approval waits and outages. Same agent mode/model and task brief across candidates; record resource limits and any deviations. |
| Operations | Production startup/readiness, graceful/forced shutdown, restart, migration durations, resource use and diagnostics. Measure against the same environment class; run timed comparisons serially without competing benchmark workloads. |
| Complexity/workarounds | Human-authored nonblank source lines excluding generated output/vendor/lockfiles, generated-code volume separately, repeated policy and glue, non-idiomatic workarounds with location/reason/official-doc reference. No minimum-file-count or architecture preference. |
| Extraction evidence | Cite actual repeated code and custom policy boundaries, with confidence limits. R1 findings are provisional and cannot justify early abstraction. |

Use a single pinned Node LTS for Fastify and Hono (Node is the proposed runtime choice for the otherwise unspecified Hono candidate); Bun for Elysia, Rust for Axum/Leptos, and the supported Encore.ts toolchain. Pin exact supported versions before worker launch, after official-documentation checks; do not impose one runtime version on a stack that does not support it. Pin the manager Playwright/browser versions once. Record runtime/frontend build tools and production mode explicitly; all candidates use optimized production builds for acceptance and timing.

Parallel implementation is permitted only at Gate 4. Runtime measurements run serially in equivalent isolated environments to reduce contention. Differences in toolchains and included platform capabilities are part of the evidence, not hidden adjustments. No raw throughput, microbenchmark request rate, or speed-only winner.

## 8. Suite validation and evidence policy for Gate 3

The manager suite lives outside every candidate and cannot import candidate source. Validate it before workers exist using disposable protocol/UI fixtures representing only test-harness behavior, not a reference Todo application or preferred application architecture. Prove failures with deliberate faults: stale overwrite accepted, input cleared on error, permissive schema hiding wrong results, duplicate create after lost response, false readiness, migration failure marked applied, and wrong filter membership. Report the exact assertions each fault trips. Fixtures cannot be handed to workers as implementation examples.

Use no automatic retries to turn a failing acceptance run green. Diagnostic reruns retain the original failure and show every attempt. Avoid sleeps as synchronization: use observed requests, responses, roles/states, explicit barriers, and bounded polling. Every injected fault asserts it was actually triggered; no-match injection fails the test. Expected results derive from the approved examples and fixed independent values, never candidate schemas alone or production helpers.

Fresh contexts and per-group databases prevent cross-test leakage; random run identifiers label external artifacts without changing expected semantics. Tests fail on unexpected response/schema errors and unhandled page errors, with known deliberate fault noise scoped explicitly. Seed through public HTTP or UI, not SQL inserts into unknown application tables. Compare full relevant record sets/identities to catch extra or lost records rather than only searching for expected text.

Keep failure traces/screenshots and redacted process/request logs. Successful runs retain only agreed representative captures: desktop populated list, mobile long-title list, and stale-edit conflict with retained draft. Inspect those captures before presenting them. No pixel baselines, routine videos, or screenshots for every successful step. Screen-reader/manual results include environment, actions performed and limitations. Trace and log collection must redact database URLs/credentials and exclude unrelated browser/session data.

Gate-3 handoff will show test inventory and mapping, final semantic contract, actual suite tree and commands, negative-control results, binding validation, database isolation/fault-injection evidence, and any remaining unassessed checks. Approval there freezes the external acceptance version for all six workers. It does not authorize deployment.
