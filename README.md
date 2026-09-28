# ERP framework comparison — phased contract

This branch holds the comparison contract, not the Featherbase application or a candidate implementation. The goal is a declarative framework for ERP applications; Todo is the small starting point.

## Current round: AdonisJS, Encore.ts and Elysia

All three use the same React/Vite baseline. Read the [proposal](openspec/changes/phased-erp-framework-comparison/proposal.md), [phase requirements](openspec/changes/phased-erp-framework-comparison/specs/phased-comparison/spec.md), [comparison mechanics](openspec/changes/phased-erp-framework-comparison/design.md), and [gated tasks](openspec/changes/phased-erp-framework-comparison/tasks.md).

| Phase | Deliverable |
| --- | --- |
| 1 | Basic ID/title CRUD with PostgreSQL and reload/restart persistence. No custom validation, conflicts or polish gate. |
| 2 | Nullable priority → backfill → NOT NULL on retained data; derived client types, runtime input/output checks, generated OpenAPI and established migrations. |
| 3 | Projects and relationships; completion/filters, title rules, conflicts, safe recovery and actual process shutdown. |
| 4 | Consistent UI finish: direct-input Enter, Escape, focus, keyboard recovery, accessible current feedback and responsive layout. |
| 5 | Define the Todo app declaratively; use documented named extension points for custom behavior; prove reuse with a runtime Supplier definition. |

**Stop for owner review after every phase.** Timings and correction cycles are recorded per phase; green tests do not imply UI polish or authorize continuation. The owner authorized this contract update; no new candidate or manager has been launched by it. No merge or deployment is authorized.

Validate planning with `npm ci && npm run spec:check`. The new phase-specific suites are not implemented yet. An authorized manager prepares, negative-controls and freezes each phase's acceptance before dispatch; do not run the historical 93 cases as Phase-1 requirements.

## Previous six-stack experiment — preserved, not the current launch contract

`openspec/changes/todo-release-1/` and `suite/` retain the original contract and frozen harness. Their historical launch instructions do not authorize new work. The final reported results were five candidates at 93/93 and Leptos at 91/93, with separate focus-timing diagnostics and polish gaps. See the [completed Large-manager comparison](https://ampcode.com/threads/T-01a0e5ea-cf02-759f-a2e1-50b89dc86a00) for results and limitations. Original source deliveries, failures and databases remain preserved; this revision does not rerun or reinterpret them.

The new comparison reuses the [ten rubric categories and weights](openspec/changes/todo-release-1/gate-2-acceptance-design.md#scoring), not the historical phase ordering or blanket acceptance requirements.
