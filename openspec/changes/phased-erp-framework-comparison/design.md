# Design

## Context

See [proposal.md](proposal.md) for intent and [the phase specification](specs/phased-comparison/spec.md) for acceptance. The earlier six-stack experiment is complete; its suite and documents remain historical. This new comparison has no candidate implementation or phase-specific harness yet. Updating this PR is not authorization to launch workers.

## Goals / Non-Goals

**Goal:** Attribute time and mistakes to a small, identifiable change; distinguish framework-provided capabilities, application decisions, environment work, and reusable ERP behavior.

**Non-goals:** A full ERP, authentication/tenancy/accounting, a general plugin marketplace, untrusted extension execution, deployment, or an early winner inferred from Todo timing. No Svelte, Rust or seventh candidate in this round.

## Decisions

### Five cumulative checkpoints

| Phase | New work | Required checkpoint evidence |
| --- | --- | --- |
| 1 | ID/title CRUD, PostgreSQL, reload/restart | Small HTTP/browser suite; owner can try each plain UI. |
| 2 | Nullable priority → backfill/NOT NULL; typed/validated/generated contracts | Preserve nullable and required revisions; populated/fresh migration evidence; client compile-failure and runtime output negative controls. |
| 3 | Projects, completion/filtering/title rules, reliable writes and process lifecycle | Relationship checks; lost replies; competing versions; independent recovery; actual listener shutdown and immediate restart. |
| 4 | Shared visual brief, direct-input keyboard semantics, focus and feedback | Same scripted desktop/mobile journey, inspected states, explicit manual/unassessed report and owner UI inspection. |
| 5 | Declarative Todo app, named extensions, Supplier reuse | Cumulative regression; same-build runtime definition activation; no core edits for Supplier; extension rollback/activation/keyboard evidence. |

Do not implement future phases early. Preserve each accepted checkpoint in Git and a verified source archive, with dependency locks and exact commands. A green test suite never advances the phase automatically; the owner reviews the results and explicitly authorizes continuation. Earlier accepted behavior remains covered in later phases. Phase 2 has two visible migration checkpoints within its single owner gate, not two unrelated clean installations.

### Three independent fresh implementations

Use AdonisJS/Node, Encore.ts with its supported runtime, and Elysia/Bun. All use React/Vite and the same pinned shared frontend baseline. Choose supported versions and a compatible shared UI component baseline before dispatch, record them in the phase manifest, and use the same baseline across candidates. A lightweight native-control baseline is enough for Phase 1; approve one common visual brief and component baseline before Phase 4. Do not let three separate UI-library experiments obscure the backend comparison.

The future manager uses Opus as requested. Use the same explicitly recorded worker model/mode, instructions, environment size and access policy for all three; inherit the manager mode unless the owner specifies otherwise. No copied previous candidate source or cross-candidate inspection. Prior findings are disclosed through this contract equally. Use supported framework-native API/database facilities before custom replacements; document exceptions against the pinned version with primary documentation or a reproduction. Do not make candidates imitate one example URL/envelope or abandon native APIs to satisfy a mapping limitation.

### Contract requirements are stronger from Phase 2, not retroactive

Use established versioned migration tooling, commit migrations and document separate migration/start commands. Do not write bespoke migration bookkeeping when a supported tool meets the contract. Where a framework lacks a separate native migration command, investigate an established compatible tool; disclose any remaining conflict for owner decision rather than silently waive the requirement or invent a private runner.

Use native typing/validation/documentation facilities where they satisfy the contract; add minimal supported integration where they do not. Elysia's raw Response bypass and serializers that coerce or omit constraints are explicit negative-control targets, not acceptable substitutes for output checks. Typed clients must be exercised by a compile-failure probe. No ORM is mandated. A compiler check is not a runtime payload check; generated documentation is not proof of either.

### A separate harness for each active phase

The manager prepares and negative-controls a small phase-specific suite before candidate dispatch, freezes its commit and gives all workers the same acceptance description. Preserve historical `suite/` unchanged; selectively reuse its mechanics in a separately named phased harness only when the active requirement needs them. The old 93-case suite is not Phase-1 acceptance. Do not manufacture a case count before the new suite exists.

Acceptance uses public HTTP and browser roles/names, not application internals. Phase 1 uses textbox `New todo`, button `Add todo`, region `Todos`, record groups named by saved title, buttons `Rename`/`Delete`, and rename textbox `Todo title` with `Save`/`Cancel`. A read operation is externally usable even if the UI only needs the list. Later phase manifests extend labels for new controls equally. Routes/envelopes remain free; publish curl examples in Phase 1 and map OpenAPI from Phase 2. Mappings cannot supply missing app behavior.

Candidate-local compile/output/migration/extension probes supplement the black-box suite where source instrumentation is necessary; the manager independently runs and checks their negative controls. A disconnected validator test is not proof that real handlers use it. Contract failures retain their original logs before fixes. Shared harness defects are disclosed and corrected equally, with original RED evidence preserved, not charged to candidate mistakes. Test retries cannot launder failures; bounded observable-state polling is allowed.

Use Chromium desktop/mobile for common flows; from Phase 3 repeat core lifecycle/recovery in Firefox/WebKit desktop/mobile. Phase 4 adds the full same-steps polish audit and actual zoom. Inspect screenshots for default, invalid, pending, uncertain and conflict states. Screen-reader/device/contrast checks need real execution or explicit unassessed status. Do not call an emulator a physical device or computed font-size changes browser zoom.

### Preserve data and isolate operations

Each new candidate owns a retained PostgreSQL database across all five phases plus separate disposable test databases. Record an initial manifest of IDs/values/deletions; verify backups by restoring into disposable databases. Never reset retained data, silently reseed it, or touch the earlier six worker databases. Negative migration/outage/force-stop tests use disposable data only. Keep credentials out of source, archives and reports.

Provide install, build, check, test, migrate and production-start commands and readiness documentation as they become applicable. Pin the same PostgreSQL release and all browser/system dependencies. Use equivalent Large orbs where available; record exceptions rather than exhausting a smaller manager. Measure shared-host builds serially. Same-build per-launch environment configuration is allowed, including native Encore infrastructure config; rebuilding for every database is not required or rewarded. No cloud deployment is authorized.

### Measure journey, correctness and finish separately

For each candidate and phase record UTC timestamps for assignment, first runnable delivery, first complete delivery, first independent result and accepted result. Report elapsed wall time, setup/download/wait time where observable, cold/warm command timings and manager-triggered correction rounds with cause. Never call wall time active coding hours or failed-test count mistake count. Separate environment faults, harness faults, implementation defects, repair regressions and optional enhancements. Keep first results and corrected results side by side.

Present a short phase comparison: outcomes; timings/cycles; UI findings; framework-provided versus custom capabilities; repeated versus one-time costs; unresolved risks. Retain the original ten [rubric categories/weights](../todo-release-1/gate-2-acceptance-design.md#scoring) for the final comparison only. Mark not-yet-exercised categories unassessed in intermediate phases, not zero; do not invent a comparable total from missing evidence. Scores are session judgments, not statistical framework rankings, and cannot override failed acceptance.

Every phase has independent functional verification and an owner-facing preview/inspection checkpoint. The final comparison must explain what the framework saves us in building an ERP engine; fastest CRUD or prettiest screenshot alone is not selection evidence.

### Declarative extraction has a public extension boundary

Before Phase 5 implementation, present the minimal definition format and named extension catalogue derived from the accepted application, not a speculative universal DSL. Owner authorization for Phase 5 includes review of that boundary. Resource definitions load at runtime; trusted custom code is registered separately and referenced by name. Document which behavior is declarative, generic framework behavior, or extension code.

A generic runtime protocol can be statically typed even though future fields are unknown to the compiler. Those fields need definition-driven runtime checks and generated documentation, not fabricated static assurances. The migration/activation mechanism remains explicit and preserves the last valid active app if a definition fails validation. A Supplier definition and validator/renderer extension tests prove the boundary without building a marketplace or sandbox.

## Risks / Trade-offs

- Later phases can dominate elapsed time → checkpoint timing and owner stops, not one end-to-end stopwatch.
- Framework-native capabilities differ → disclose exact gaps and integration work; no undocumented exceptions or raw bypasses.
- Agent learning from earlier rounds biases results → fresh sources, identical disclosed lessons, and no claim of statistical significance.
- A declarative wrapper can hide copied Todo code → inspect core for resource-specific branches and add Supplier without core edits.
- Dynamic metadata and compile-time typing cover different guarantees → test both boundaries explicitly.

## Migration Plan

This PR changes planning only; no database migration is executed. The new manager preserves historical evidence and creates new isolated candidates after launch authorization. Phase 2 upgrades retained Phase-1 data through two committed revisions; Phase 3 adds relationships/state without resets; Phase 5 preserves the same data while changing implementation ownership. Before each upgrade, verify a disposable restore and document recovery to the last accepted revision; destructive rollback is never presumed safe.
