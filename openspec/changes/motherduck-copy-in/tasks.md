## 1. First-time setup

Skipped: `acceptance-tests/` already exists.

## 2. Test stand-in for MotherDuck (design D4)

- [x] 2.1 A local DuckDB file with `md_information_schema.shared_with_me`, an owned-database list and attachable database files ("sales", "stock" and three more), built by a test helper; `MOTHERDUCK_STANDIN` points the connection at it, refused outside development and test
- [x] 2.2 The acceptance stack starts the API with the stand-in, and step helpers can add a table to "sales" (for the refresh scenario)

## 3. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 3.1 external-data-sources: connect — a working token shows its owner and database count; a refused token is explained, not echoed; a writable token is flagged
- [x] 3.2 external-data-sources: choose databases — only the ticked databases are offered; saving is blocked with none ticked
- [x] 3.3 external-data-sources: token secrecy — only the last four show; replacing the token shows the new last four
- [x] 3.4 external-data-sources: sidebar — the source and its databases are listed; someone who is not a System Manager sees no source
- [x] 3.5 external-data-sources: browse — a warehouse table's size, first rows and column names show
- [x] 3.6 external-data-sources: remembered place — the browser opens on the last schema
- [x] 3.7 external-data-sources: table list cache — a table added since shows after a refresh
- [x] 3.8 Approved design A: replace chip-specific component assertions with catalog/preview tab and copy-breadcrumb return coverage; establish a focused red against the synthetic MotherDuck stand-in
- [x] 3.9 Add complete-collection regression cases: a catalog beyond 64 tables and an 80-column mapping; editing a filtered mapping row must update its source identity, not its visible index
- [ ] 3.10 Apply the approved-design-A spec amendment in a specs-only unit after the shared code-zone work is committed; do not stash another worker's changes
- [ ] 3.11 Run the amended effective acceptance scenarios and component regressions to green, including retained filters/selection, editable mapping, empty search and source identity

## 4. Server (unit-tested against real Postgres and the stand-in)

- [x] 4.1 `SECRET_STORE_KEY` in the variable registry; AES-256-GCM encrypt/decrypt with tamper detection; a token never appears in an error or log
- [x] 4.2 Data Source gains the encrypted token, its last four, and the chosen databases (migration); the controller encrypts a pasted token on save and refuses a MotherDuck source with no database chosen
- [x] 4.3 Driver: single-attach MotherDuck session attaching only the chosen databases (the `md:` opening stays in the hosted-service module)
- [x] 4.4 Row action: test a token before saving → owner, databases (owned and shared, with owner), can-write
- [x] 4.5 Table-list cache table; row actions to read a database's schemas and tables (cached) and refresh them
- [x] 4.6 Row action: preview one table → row and column counts, first rows, column names
- [x] 4.7 Every new action is System Manager only

## 5. Web

- [x] 5.1 "Connect a data source" page on the Data Source table's New action: kind tiles that fold, token with Test, result under it, database ticks with search, Save and browse tables (issue checklist 1–9)
- [x] 5.2 The data source page shows "token saved, ending …" with Replace token, and the chosen databases (checklist 9)
- [x] 5.3 Sidebar Data sources group, System Managers only (checklist 10–11)
- [ ] 5.4 Approved design A replaces pane/chip navigation: searchable DataList catalog and full-content catalog/preview tabs; preserve database, schema, catalog search and selected table across tab switches and copy-breadcrumb return; retain listed-when, Refresh and remembered place (checklist 12–15, 21–26)
- [ ] 5.5 Editable mapping uses DataList with real inputs and complete-collection search over source names and edited names, labels and descriptions; edits and keep choices survive filtering and remain attached to their original source column
- [ ] 5.6 Keep native ListView/FormView and all backend operations unchanged; independently verify full-content layout, breadcrumbs and the approved checklist in a headless desktop browser

## 6. Completion

- [ ] 6.1 Full acceptance suite and `pnpm --filter server test` pass; coverage baselines hold (ADR 0017)
- [ ] 6.2 Codex review (server: token storage, connection, actions) — blockers fixed
- [ ] 6.3 Independent UI verifier against issue #772 checklist 1–15 at 1280 px, with screenshots — differences fixed
- [x] 6.4 Tried against a real MotherDuck account on a local Featherbase
