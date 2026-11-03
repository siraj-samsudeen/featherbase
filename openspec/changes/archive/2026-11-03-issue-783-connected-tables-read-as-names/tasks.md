## 1. First-time setup

Skipped: `acceptance-tests/` exists. Uses #782's outside-database harness (merge #782 first).

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

- [x] 2.1 external-data-sources: "a Postgres database of shelves and the bins on each shelf"
- [x] 2.2 external-data-sources: "a data source for that database"
- [x] 2.3 external-data-sources: "the user connects its shelf and bin tables, naming them …" (Browse page object: the name box)
- [x] 2.4 external-data-sources: "the user sees tables called … in Featherbase"
- [x] 2.5 external-data-sources: "its shelf and bin tables connected as …" and "a bin on the shelf titled …"
- [x] 2.6 external-data-sources: "the user opens a bin" and "its link to a shelf labelled …"
- [x] 2.7 external-data-sources: "the user opens that bin's relationship map" and "its shelf as …"

## 3. Implementation

- [x] 3.1 Browse screen: an editable proposed name per connectable table, sent as `names`; the relationship map's wide link boxes show the linked row's title (the spec's map scenario needs it; #794 point 2 delivered here)
- [x] 3.2 Reflect accepts `names`; link labels drop the trailing "id" (written while prototyping; proved by 2.4 and 2.6)
- [x] 3.3 `rowTitles` reads source-bound titles through the scoped list (written while prototyping; proved by 2.7)
- [x] 3.4 Server integration tests: `apps/server/test/sources-postgres-names.test.ts`

## 4. Completion

- [x] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps — 65 scenarios: 64 passed; "An installed app preserves the platform name" failed, as in #782's run: #806
- [x] 4.2 Server source and row-title tests pass; `pnpm check:specs` passes
