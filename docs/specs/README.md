# Legacy Journey specs — frozen migration evidence

> **Non-authoritative since 2026-09-21.** OpenSpec is the sole behavior
> specification and mandatory change workflow; see
> [ADR 0010](../adr/0010-openspec-change-workflow.md) and root `AGENTS.md`.
> Do not add files or behavior here. `pnpm check:spec-policy` freezes this
> directory while each capability is baselined into `openspec/specs/` or retired.

These documents preserve the pre-adoption Journey contracts as dated migration
evidence. They help recover existing behavior, but they do not govern current
or future implementation. A baseline migration verifies current code and tests,
commits the OpenSpec capability without behavior changes, then removes the
migrated path from this directory and `tools/legacy-spec-baseline.txt`.

When migrating one of these documents, use
[Recognizing product features](../design/recognizing-product-features.md) to
identify the OpenSpec capability boundary before writing the baseline.

Historical format: feather-spec — a one-pager per feature with EARS acceptance
criteria grouped by user capability. Its legacy IDs remain useful when tracing
history, but new code and tests cite descriptive OpenSpec slugs with `@spec`.

These IDs replace the old harness feature IDs. That inventory is frozen
history at [`docs/archive/harness-2026/`](../archive/harness-2026/README.md)
(retired 2026-08-28, issue #236); nothing here extends it.

The historical `> evidence:` verdicts are preserved as migration inputs. Current
spec↔code↔test linkage is the OpenSpec `@spec` convention documented in
[`docs/agents/stc-traceability.md`](../agents/stc-traceability.md).

| Spec | Status | Summary |
|---|---|---|
| [0001 — External Data Sources](0001-external-data-sources.md) | Proposed | DocTypes bound to existing tables in another Postgres, with no change to the foreign schema |
| [0002 — Virtual DocTypes](0002-virtual-doctypes.md) | Proposed | Controller-supplied storage for sources that are not Postgres tables |
| [0003 — Table Deletion](0003-table-deletion.md) | Built 2026-08-04 | Delete a Table outright — schema references block, live pointers sweep, text testimony survives. First journey-spec trial |
| [0004 — Import Upsert](0004-import-upsert.md) | Built 2026-08-05 | Spreadsheet import upserts by key |
| [0005 — Import Revert](0005-import-revert.md) | Built 2026-08-11 | Row-level reverse of a completed import |
| [0006 — Connection Console](0006-connection-console.md) | Proposed | Connect a Data Source through the UI: typed credentials encrypted at rest, phased test with inline diagnosis, post-auth database dropdown, verified grants, advanced disclosure, saved-source health |
| [0008 — Spreadsheet Import](0008-spreadsheet-import.md) | Built (retrofit 2026-09-04) | The import wizard end to end: the file overview, merge groups and user combines, the stepper, leave-and-resume, past imports, column edits and Table merge — recovered from PR #210 plus the wizard core |
| [0009 — Grid Editing](0009-grid-editing.md) | Proposed — specification only (#259) | Existing native business rows; server-derived eligibility, atomic per-field merge, conditional conflict confirmation, idempotent retry, keyboard editing and in-memory draft/navigation safety |
| [Tasker](../../openspec/TASKER.md) | Built with explicit gaps (#296) | OpenSpec is the sole behavior contract; the local compatibility pointer records the retired duplicate surface |
| [0011 — Trusted Runtime Packages](0011-runtime-packages.md) | Learning slice 2026-09-21 (#296) | Independent Tasker/Other artifacts, qualified storage, disable/re-enable and fail-closed package availability |

Both are shaped by [ADR 0007](../adr/0007-app-and-database-topology.md) and the
research note [Frappe: many apps in one instance](../research/frappe-multi-app-and-multi-db.md).
