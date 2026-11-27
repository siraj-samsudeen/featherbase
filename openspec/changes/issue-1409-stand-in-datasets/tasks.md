## 1. Acceptance tests first

- [ ] 1.1 Bind every server-side scenario of `stand-in-datasets` in `apps/server/test/scenarios/stand-in-datasets.test.ts`, failing.
- [ ] 1.2 Bind the two on-screen scenarios (the page's line, the Datasets page) in `apps/web/test/scenarios/stand-in-datasets.test.tsx`, failing.

## 2. Server

- [ ] 2.1 Migration: the `Dataset Binding` system Table, `stand_in` on the snapshot registry; the pinned migration list.
- [ ] 2.2 Snapshot engine: a stand-in candidate, its shape identity, never a baseline (D1, D3, D4).
- [ ] 2.3 Binding: controller, production rule, settings-file scope (D2, D8).
- [ ] 2.4 Check and load a CSV; list; switch to the warehouse (D7).
- [ ] 2.5 Reads: `served: 'stand-in'`, `live()`, no Data Source needed, the Access Log (D5).
- [ ] 2.6 The refresh job and recorded misses leave a stand-in alone.
- [ ] 2.7 The response header on every answer that served stand-in rows (D6).
- [ ] 2.8 MCP tools: `list_datasets`, `check_stand_in`, `load_stand_in`, `switch_to_warehouse`.

## 3. Screens (UI route, issue #1409 points 11 to 24)

- [ ] 3.1 The stand-in line, in the Admin shell and the shared bar.
- [ ] 3.2 The Datasets page and its sidebar entry.
- [ ] 3.3 Independent verifier at 1280 px against the checklist; fix the differences.

## 4. Proof and hand-over

- [ ] 4.1 Fixture app `stand-in-proof`: one warehouse and one stand-in dataset on one page; a served e2e that switches it.
- [ ] 4.2 Docs: `CONTEXT.md` terms, `docs/DEPLOY.md` settings-file note.
- [ ] 4.3 Code review (Opus, one round) of the server and MCP changes; fix what is real.
- [ ] 4.4 Local gates: both typechecks, the suites, `pnpm check:scenarios`, `pnpm check:specs`.
