# Specs

**Evidence mode:** excluded — an index of the specs, carrying no obligations
of its own.

Requirements for work that is **agreed but not yet built**. Once a spec is
implemented and verified end-to-end, it stays here as the contract the code was
written against; `PROGRESS.md` records when that happened.

Format: feather-spec — a one-pager per
feature with EARS acceptance criteria (`WHEN … THE SYSTEM SHALL …`) grouped by
user capability, each group carrying a concrete example table. Capability IDs
(`EDS-1`, `VDT-3`) are the traceability handle: use them in commits, bugs and
review comments.

These IDs replace the old harness feature IDs. That inventory is frozen
history at [`docs/archive/harness-2026/`](../archive/harness-2026/README.md)
(retired 2026-08-28, issue #236); nothing here extends it.

**Evidence lives in the spec, not beside it.** Specs written in the
journeys-and-rules form carry a `> evidence: proven | rule-tier | gap |
pinned #N — <note>` line under every journey, rule, invariant and hazard,
and `node tools/check-evidence.mjs` (`pnpm check:evidence`, and a CI step)
re-derives the linkage against the test titles that back it. The
hand-maintained `evidence/*.csv` matrices this replaced were retired
2026-08-28 (issue #235).

| Spec | Status | Summary |
|---|---|---|
| [0001 — External Data Sources](0001-external-data-sources.md) | Proposed | DocTypes bound to existing tables in another Postgres, with no change to the foreign schema |
| [0002 — Virtual DocTypes](0002-virtual-doctypes.md) | Proposed | Controller-supplied storage for sources that are not Postgres tables |
| [0003 — Table Deletion](0003-table-deletion.md) | Built 2026-08-04 | Delete a Table outright — schema references block, live pointers sweep, text testimony survives. First journey-spec trial |
| [0004 — Import Upsert](0004-import-upsert.md) | Built 2026-08-05 | Spreadsheet import upserts by key |
| [0005 — Import Revert](0005-import-revert.md) | Built 2026-08-11 | Row-level reverse of a completed import |
| [0006 — Connection Console](0006-connection-console.md) | Proposed | Connect a Data Source through the UI: typed credentials encrypted at rest, phased test with inline diagnosis, post-auth database dropdown, verified grants, advanced disclosure, saved-source health |

Both are shaped by [ADR 0007](../adr/0007-app-and-database-topology.md) and the
research note [Frappe: many apps in one instance](../research/frappe-multi-app-and-multi-db.md).
