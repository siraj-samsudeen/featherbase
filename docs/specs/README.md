# Specs

Requirements for work that is **agreed but not yet built**. Once a spec is
implemented and verified end-to-end, it stays here as the contract the code was
written against; `PROGRESS.md` records when that happened.

Format: feather-spec — a one-pager per
feature with EARS acceptance criteria (`WHEN … THE SYSTEM SHALL …`) grouped by
user capability, each group carrying a concrete example table. Capability IDs
(`EDS-1`, `VDT-3`) are the traceability handle: use them in commits, bugs and
review comments.

These IDs are deliberately **not** in `harness/features.json` — that file is
frozen except for `status` flips (see `CLAUDE.md`).

| Spec | Status | Summary |
|---|---|---|
| [0001 — External Data Sources](0001-external-data-sources.md) | Proposed | DocTypes bound to existing tables in another Postgres, with no change to the foreign schema |
| [0002 — Virtual DocTypes](0002-virtual-doctypes.md) | Proposed | Controller-supplied storage for sources that are not Postgres tables |
| [0003 — Table Deletion](0003-table-deletion.md) | Built 2026-08-04 | Delete a Table outright — schema references block, live pointers sweep, text testimony survives. First journey-spec trial (evidence: [evidence/table-deletion.csv](evidence/table-deletion.csv)) |
| [0004 — Import Upsert](0004-import-upsert.md) | Built | Spreadsheet import upserts by key (evidence: [evidence/import-upsert.csv](evidence/import-upsert.csv)) |
| [0005 — Import Revert](0005-import-revert.md) | Proposed | Row-level reverse of a completed import (evidence: [evidence/import-revert.csv](evidence/import-revert.csv)) |
| [0006 — Connection Console](0006-connection-console.md) | Proposed | Connect a Data Source through the UI: typed credentials encrypted at rest, phased test with inline diagnosis, post-auth database dropdown, verified grants, advanced disclosure, saved-source health (evidence: [evidence/connection-console.csv](evidence/connection-console.csv)) |
| [0007 — Budget Books](0007-budget-books.md) | Proposed | Grain-agnostic budget versioning + approval: a book binds any table's key/measure columns, baseline freezes v0, all further writes ride approved Budget Changes (evidence: [evidence/budget-books.csv](evidence/budget-books.csv)) |

Both are shaped by [ADR 0007](../adr/0007-app-and-database-topology.md) and the
research note [Frappe: many apps in one instance](../research/frappe-multi-app-and-multi-db.md).
