## 1. First-time setup

Skipped: `acceptance-tests/` already exists.

## 2. Step definitions — each: fails for the right reason → implement → passes → commit

Scenario "Shops connect through a login that owns nothing" (external-data-sources).

- [x] 2.1 Harness: a sibling test database `<acceptance database>_ext`, and the API started with an environment variable naming a reader login on it, so a data source can reach it (`support/stack.js`)
- [x] 2.2 external-data-sources: "the user is a System Manager"
- [x] 2.3 external-data-sources: "a Postgres database with a shop table whose rows are identified by their id"
- [x] 2.4 external-data-sources: "a data source whose login may only read that table and owns nothing"
- [x] 2.5 external-data-sources: "the user browses the data source" (a source-browser page object under `support/pages/`)
- [x] 2.6 external-data-sources: "the shop table is offered for connecting" — red on `main`: offered as unusable, "Needs a single-column primary key"
- [x] 2.7 external-data-sources: "the user connects it"
- [x] 2.8 external-data-sources: "the user sees the database's shops listed in Featherbase"

## 3. Implementation

- [x] 3.1 Postgres introspection reads primary keys from `pg_constraint` (design.md). Written before this change existed, while prototyping; kept on the branch and proved here: 2.6 fails without it and passes with it
- [ ] 3.2 Server integration test: a non-owner login sees the key and connects the table (`apps/server/test/sources-postgres-read-only-login.test.ts`)

## 4. Completion

- [ ] 4.1 Acceptance suite: every scenario passes, zero pending or undefined steps, HTML report generated
- [ ] 4.2 Server source tests pass; `pnpm check:specs` passes
