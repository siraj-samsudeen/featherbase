## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness, #783's shelves-and-bins steps and #808's app-install steps (merged into this branch).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 external-data-sources: "a Postgres database of crates on pallets that declares no keys or links", "a crate numbered … holding … on the pallet …"
- [ ] 2.2 external-data-sources: the four "an app that connects its … identified by …" givens (crate alone; crate and pallet with a link; shelf by its label; crate linking to a missing table; shelf by its id and bin with an agreeing link)
- [ ] 2.3 external-data-sources: "the user opens crate …", "the user sees the crate holds …", "the user sees the crate's pallet as …", "the user sees the bin's shelf as …", "the user is told the shelf table is already identified by its …", "the user is told the source has no table …"

## 3. Implementation

- [ ] 3.1 Reflect: `TableSettings` gains `key` and `links`; validated with the other settings before any Table is created (column present and not left out; target on the source, allowed and keyed; agrees with the source's pk and foreign keys); overlaid on the introspected table before its candidate is built
- [ ] 3.2 Server tests (`apps/server/test/app-sources-keys-links.test.ts`): declared key, declared link in both connection orders, agreeing declarations accepted, each refusal
- [ ] 3.3 StyleHR: `stylehr/app.json` declares `key: "id"` and its links; new `stylehr-warehouse/` manifest and README over `bronze_stylehr.public`; a server test keeps the two apps' `reflect.tables` identical; `client-apps/jeyarama/CLAUDE.md` and the `connect-an-outside-database` guide updated
- [ ] 3.4 Live proof (owner check, local only): install StyleHR (warehouse) against MotherDuck on a disposable database; a store's floors, an employee's designation and manager, and the relationship map show names and links

## 4. Completion

- [ ] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.2 Server tests pass; server typechecks; `pnpm check:specs` passes
