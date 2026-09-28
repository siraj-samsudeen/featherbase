# Gate 2 — How we will compare the six apps

**Status:** Gates 1 and 2 approved. The shared suite is implemented and independently self-tested. The owner authorized six Medium-mode workers after the contract PR opens, without another review wait. Candidate results still require Gate-4 review; no deployment is authorized.

## Scoring

| Category | Weight |
| --- | ---: |
| Correctness and guardrails | 22 |
| Agent success and predictability | 15 |
| Contract quality | 10 |
| Migration behavior | 10 |
| Frontend accessibility and resilience | 10 |
| Custom-code clarity | 8 |
| Operational behavior | 8 |
| Implementation complexity | 7 |
| Iteration speed | 5 |
| Future extraction suitability | 5 |

Rate each 0–4: broken, major gaps, material friction, meets expectations, unusually strong evidence. Points = weight × rating / 4. Link evidence; separate measurements from judgment. Missing evidence stays unassessed, not a made-up score.

Report test failures separately: high scores cannot excuse incorrect behavior. Allow repair and verify fixes. Eliminate only for unresolved hard correctness, reproducibility, or framework-support blockers—not speed, code size, or unfamiliarity. No throughput scoring or reward for premature framework building.

## What the tests cover

The [product spec](specs/todo/spec.md) defines expected results; we will not repeat it here.

| Area | Checks |
| --- | --- |
| Everyday use | Create, rename, complete, reopen, delete; duplicate titles; repeated submission; All/Open/Completed filters and empty states. |
| Titles | Trimming, preserved internal text, Unicode length boundaries, invalid input, and markup displayed safely. |
| Persistence | Reload, new browser session, graceful restart, and forced app termination preserve confirmed changes and deletions. |
| Failures | Failed reads/writes preserve input and confirmed state; retry works; lost success responses do not create duplicates. |
| Concurrent sessions | Reject stale rename/complete/reopen/delete, simultaneous writes, and changed-back values; handle deletion elsewhere; retain drafts. |
| Accessibility | Keyboard flows, labels, focus, announcements, error associations, and a separately reported real screen-reader check. |
| Responsive layout | Desktop 1280×800, mobile 390×844, narrow 320px, 200% text zoom, and long titles. |
| HTTP API | Discover OpenAPI; exercise all operations; validate responses and reject invalid direct requests without changing data. |
| Migrations | Empty setup, safe rerun, failure/retry, competing migrations, and data preservation. |
| Operations | Reproducible production build/run, truthful readiness, DB outage recovery, shutdown, and restart. |

Run all browser checks in **Chromium**. Repeat core flows and failure/conflict/layout checks on mobile; run create/edit/filter in **Firefox and WebKit**, desktop and mobile. HTTP, migration, and process checks run separately. Emulated mobile is not a real device; automated accessibility checks do not prove screen-reader usability. Report untested cases honestly.

## Shared UI labels

Use accessible roles and these names, never CSS selectors or test IDs. Layout and components are free.

| Surface | Contract |
| --- | --- |
| Create | Textbox `New todo`; button `Add todo`. |
| List | Region `Todos`; each record is a group named by its saved title, containing checkbox `Completed` and buttons `Rename`, `Delete`. Duplicate titles are allowed. |
| Edit | Group or dialog `Rename todo`; textbox `Todo title`; `Save` and `Cancel`. Cancel makes no change. |
| Filters | Group `Filter todos`; buttons `All`, `Open`, `Completed`; selected button exposes pressed state. |
| Feedback | Status for progress/success, alert for errors. Empty text: `No todos`, `No open todos`, or `No completed todos`. |
| Recovery | `Retry` for known failure; `Check status` for uncertain saves; `Todo changed` with `Review latest` before deliberate retry. Keep drafts. |
| Deleted elsewhere | `Todo no longer exists`; keep any draft recoverable until `Cancel`. |
| Optional delete confirmation | Dialog `Delete todo`; `Confirm delete` and `Cancel`. |

## Isolation and process control

- Give each candidate a fresh PostgreSQL database and private non-superuser credentials through `DATABASE_URL`. Use the same PostgreSQL version; verify candidates cannot access each other's databases.
- Separate disposable development/test databases from each candidate's **retained R1 database**, which continues into R2. Back up and verify restoration; never reset that retained database.
- Each independent test group gets a fresh database and browser contexts. Restart/concurrency tests keep their database across their own steps.
- Candidates document install, build, static-check, test, migrate, and production-start commands, plus readiness and OpenAPI locations.
- The manager supplies the port and `BASE_URL`, supervises the process tree, checks readiness through real HTTP reads, and controls graceful shutdown, forced termination, and restart. Restart uses the same build and database, with no reset/reseed. Timeouts are diagnostic limits, not speed-based elimination rules.

## Measurements and fairness

Record setup friction; agent corrections and escaped mistakes; direct/transitive runtime/dev dependencies; build/typecheck/test durations; startup/migration/shutdown times; handwritten versus generated code; and non-idiomatic workarounds with reasons. Judge clarity and extraction potential from actual code, not raw counts or speculation.

Use the same agent/model and equivalent environments. Pin supported toolchains before launch: Bun for Elysia, Node for Fastify/Hono, Rust for Axum/Leptos, and Encore's supported toolchain. Measure production builds, separate cold/warm runs, and time candidates serially. Record commands, versions, failures, interventions, and any environment differences. Keep first-submission and corrected results.

## Shared-suite safeguards

- The suite stays outside candidate implementations and imports none of their code. Manager-owned HTTP mappings use published OpenAPI, leaving routes and response layouts free; they cannot supply missing app behavior.
- Inject failures through Playwright where possible, otherwise an external proxy. Verify injection actually happened. Use two independent browser contexts for conflicts.
- Assert exact saved outcomes and unchanged unrelated data—not just visible success messages. Do not hide failures with automatic retries.
- Validate the suite against deliberately broken test fixtures before workers start. Present coverage, structure, evidence, and limitations at Gate 3; the owner subsequently waived that review wait after validation and opening the contract PR. Gate-4 owner review remains required.
- Keep redacted failure traces/screenshots and only three successful representative captures: desktop list, mobile long title, and conflict with retained draft. Inspect them; no pixel-perfect comparisons.

Detailed test mechanics belong in the Gate-3 suite, not another prose specification. Freeze the suite before workers start; disclose later corrections and rerun affected candidates consistently. No deployment is authorized.
