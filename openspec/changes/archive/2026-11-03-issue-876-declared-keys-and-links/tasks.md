## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness, #783's shelves-and-bins steps and #808's app-install steps (merged into this branch). Two fixtures, on purpose: the shelves declare their keys and links (agreeing and differing declarations), the crates must declare neither (a warehouse copy's shape).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 external-data-sources: "a Postgres database of crates on pallets that declares no keys or links", "a crate numbered … holding … on the pallet …"
- [x] 2.2 external-data-sources: the six "an app that connects …" givens (crate by its number; crate and pallet with a link; shelf by its label; crate linking to a missing table; shelf by its id and bin with an agreeing link; bin linking to the bins). The agreeing-link scenario is a guard: it may pass before the change.
- [x] 2.3 external-data-sources: "the user opens crate …", "the user sees the crate holds …", "the user sees the crate's pallet as …", "the user sees the bin's shelf as …", "the user is told the shelf table is already identified by its …", "the user is told the source has no table …", "the user is told the bin's shelf already links to the shelves"

## 3. Implementation

- [x] 3.1 Reflect: `TableSettings` gains `key` and `links`; validated with the other settings before any Table is created (column present, not left out, not credential-named; key only on a read-only source and never one column of a multi-column source key; target on the source, allowed, and keyed by its source or this install, never the first-column fallback; agrees with the source's pk and foreign keys); overlaid on the introspected table before its candidate is built; #808's checks get the declared key
- [x] 3.2 Server tests (`apps/server/test/app-sources-keys-links.test.ts`): declared key, declared link in both connection orders, agreeing declarations accepted, each refusal (incl. writable source, multi-column key, disallowed target worded as missing, keyless target)
- [x] 3.3 StyleHR: `stylehr/app.json` declares `key: "id"` and its links; new `stylehr-warehouse/` manifest and README over `bronze_stylehr.public`; a server test keeps the two apps' `reflect.tables` identical; `client-apps/jeyarama/CLAUDE.md` and the `connect-an-outside-database` guide updated
- [x] 3.4 Live proof (owner check, local only): install StyleHR (warehouse) against MotherDuck on a disposable database; a store's floors, an employee's designation and manager, and the relationship map show names and links — 03-Nov-2026: 13 tables in 14 s, key `id` on all, 30 links; an employee's designation, manager, department and onboarding store read as names; a store's map shows its organisation and firm, 83 floors, 333 sections. The loader's `_dlt_*` columns showed, so the warehouse app now leaves them out.

## 4. Completion

- [x] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps — 212 scenarios: 209 passed; the two "running an instance" scenarios failed (port 5204 held by another worktree's server); the captured-email raw-values check expected a disabled input where #795 shows a value, fixed on #795 to check that nothing is editable, and it passes
- [x] 4.2 Server tests pass; server typechecks; `pnpm check:specs` passes — the change's tests and #808's pass (57); 21 failures in release-preflight, identity, person-registry and instance-health tests fail the same on #808's branch without this change (this machine's environment)
