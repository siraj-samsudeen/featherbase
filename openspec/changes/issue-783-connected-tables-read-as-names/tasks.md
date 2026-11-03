## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness (merge #782 first).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [ ] 2.1 external-data-sources: "a Postgres database of shelves and the bins on each shelf"
- [ ] 2.2 external-data-sources: "a data source for that database"
- [ ] 2.3 external-data-sources: "the user connects its shelf and bin tables, naming them …" (Browse page object: the name box)
- [ ] 2.4 external-data-sources: "the user sees tables called … in Featherbase"
- [ ] 2.5 external-data-sources: "its shelf and bin tables connected as …" and "a bin on the shelf titled …"
- [ ] 2.6 external-data-sources: "the user opens a bin" and "its link to a shelf labelled …"
- [ ] 2.7 external-data-sources: "the user opens that bin's relationship map" and "its shelf as …"

## 3. Implementation

- [ ] 3.1 Browse screen: an editable proposed name per connectable table, sent as `names`
- [ ] 3.2 Reflect accepts `names`; link labels drop the trailing "id" (written while prototyping; proved by 2.4 and 2.6)
- [ ] 3.3 `rowTitles` reads source-bound titles through the scoped list (written while prototyping; proved by 2.7)
- [ ] 3.4 Server integration tests: `apps/server/test/sources-postgres-names.test.ts`

## 4. Completion

- [ ] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps
- [ ] 4.2 Server source and row-title tests pass; `pnpm check:specs` passes
