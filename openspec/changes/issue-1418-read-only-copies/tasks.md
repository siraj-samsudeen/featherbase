## 1. Tests first

- [x] 1.1 One bound scenario test per scenario of `read-only-copies`, on a made-up warehouse (the MotherDuck stand-in) and a test app declaring the forecast lines and daily sales copies

## 2. Declaration and storage

- [x] 2.1 Migration: `table_copy` gains mode, query, run check and last run answer; the editable columns become optional for a read-only copy; the `featherbase_copy` schema
- [x] 2.2 The manifest's `datasets[]` entry: `store` (table by default, json on request), `rowKey`, `runKey`, `loadRoles`, `onNewLoad`, the two copy guards; Dash and the dataset fixture say `store: "json"` (Dash in a version step, no Table change)
- [x] 2.3 Install and upgrade make the app's copies match its declaration (create, add or drop a column, rebuild on a changed type or key, remove). A runtime app is never uninstalled (only disabled), so there is no teardown there
- [x] 2.4 The copy's Table is system-written (nobody edits it) and reads through a view of its active load

## 3. Bulk loader

- [x] 3.1 Shape check: describe the query on the source (DuckDB and Postgres) and compare with the declaration by type family
- [x] 3.2 Stream the query with the run check's values into a new load partition by `COPY`; refuse a repeated or empty key
- [x] 3.3 Guards as SQL aggregates on the load, then the registry flip; the previous load kept, older ones dropped; a failed load dropped and recorded

## 4. Sync

- [x] 4.1 (D5 as ruled 28-Nov-2026) `POST /api/copy_load { table, force }`: a System Manager or a `loadRoles` holder queues one load job; `:copy_load_state` says what the copy holds and why its last load failed. No Scheduled Job for a read-only copy
- [ ] 4.2 The Admin's bar on a read-only copy: Check for a new run, Load now, its last load and why it failed (UI route: mockup, checklist in the issue, verifier)

## 5. After a load, and reads

- [x] 5.1 `onNewLoad`: queue the app's job with the two loads; `ctx.newLoad.moves()` in its context
- [x] 5.2 `ctx.datasets.active()` reads a copy through the reader's places

## 6. Hand-off

- [ ] 6.1 Gates (both typechecks, touched suites, coverage, `check:scenarios`, `check:specs`), the review, the PR body with the warehouse's part and the renamed-column demo
- [x] 6.2 Siraj ratified the design decisions (28-Nov-2026, D5 changed)
- [ ] 6.3 Archive this change
