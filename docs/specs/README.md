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

Both are shaped by [ADR 0007](../adr/0007-app-and-database-topology.md) and the
research note [Frappe: many apps in one instance](../research/frappe-multi-app-and-multi-db.md).
