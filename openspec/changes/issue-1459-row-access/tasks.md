## 1. Scenario tests

- [x] 1.1 Bind every row-access scenario (`apps/server/test/scenarios/row-access.test.ts`)

## 2. Platform

- [x] 2.1 The closed set of rules in shared (`rowRuleSchema`, `rowRuleWords`)
- [x] 2.2 Migration 0187: `table_def.row_rule`; existing platform and instance Tables get `all`
- [x] 2.3 `row-rule.ts`: the effective rule, its SQL condition and its single-row check, closed when undeclared
- [x] 2.4 Apply it in `scopedWhere`, a Sub-table's parent, Comments/Versions/Files, `assertUserPermissions`, connected Tables and realtime
- [x] 2.5 A Table's definition carries the rule; a renamed column is renamed in it, a named column cannot be removed
- [x] 2.6 An app's `rowRules`, checked at load; `scopedTables` removed
- [x] 2.7 A System Manager sets a rule on any Table and lists every Table's rule; MCP's `create_table` takes one

## 3. Apps

- [x] 3.1 Dash, Equipment, Tasker, Tickets declare `all` for each Table (what they do today), each a new version
- [x] 3.2 Forecasting: the four review Tables move from `scopedTables` to `places`; the rest declare `all`
- [x] 3.3 `pnpm check:row-rules`: an app in this repo leaves no Table without a rule

## 4. Proof

- [ ] 4.1 `row-rules.test.ts` on every read path; the wide platform suites with every test Table given a rule
- [ ] 4.2 A local Dash instance with made-up data: `GET /api/row_rules` before and after
- [ ] 4.3 One independent access-control review; real findings fixed
