## 1. Acceptance tests first

- [x] 1.1 Bind every server-side scenario of `stand-in-datasets` in `apps/server/test/scenarios/stand-in-datasets.test.ts`, failing.
- [x] 1.2 Bind the two on-screen scenarios (the page's line, the Datasets page) in `apps/web/test/scenarios/stand-in-datasets.test.tsx`, failing.

## 2. Server

- [x] 2.1 Migration: the `Dataset Binding` system Table, `stand_in` on the snapshot registry; the pinned migration list.
- [x] 2.2 Snapshot engine: a stand-in candidate, its shape identity, never a baseline (D1, D3, D4).
- [x] 2.3 Binding: controller, production rule, settings-file scope (D2, D8).
- [x] 2.4 Check and load a CSV; list; switch to the warehouse (D7).
- [x] 2.5 Reads: `served: 'stand-in'`, `live()`, no Data Source needed, the Access Log (D5).
- [x] 2.6 The refresh job and recorded misses leave a stand-in alone.
- [x] 2.7 The response header on every answer that served stand-in rows (D6).
- [x] 2.8 MCP tools: `list_datasets`, `check_stand_in`, `load_stand_in`, `switch_to_warehouse`.

## 3. Screens (UI route, issue #1409 points 11 to 24)

- [x] 3.1 The stand-in line, in the Admin shell and the shared bar.
- [x] 3.2 The Datasets page and its sidebar entry.
- [x] 3.3 Independent verifier at 1280 px against the checklist; fix the differences.

## 4. Proof and hand-over

- [x] 4.1 Fixture app `stand-in-proof`: one warehouse and one stand-in dataset on one page; a served e2e that switches it.
- [x] 4.2 Docs: `CONTEXT.md` terms, `docs/DEPLOY.md` settings-file note.
- [x] 4.3 Code review (Opus, one round) of the server and MCP changes; fix what is real.
- [x] 4.4 Local gates: both typechecks, the suites, `pnpm check:scenarios`, `pnpm check:specs`.

## 5. Owner

- [ ] 5.1 The owner looks at the two screens and the decisions listed in the PR, and changes what he dislikes.
- [ ] 5.2 Archive this change (sync the specs) as the branch's last commit, and accept ADR 0028.
