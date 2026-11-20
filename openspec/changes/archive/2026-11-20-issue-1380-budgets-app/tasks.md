## 1. Design

- [x] 1.1 Data model, roles and the decisions taken for the owner's review (`docs/plans/budgets_app_data_model.md`)
- [x] 1.2 Numbered design checklist in #1380

## 2. Tests first

- [x] 2.1 Server tests: two roles, the ceiling on every table, a viewer reads and changes nothing
- [x] 2.2 Unit tests: subtotals, the budget in force, what remains of an adjustment, reading pasted cells
- [x] 2.3 Web component tests: FigureMatrix, PasteRows, FoldToggle
- [x] 2.4 Server tests: save rules and operations; actuals through the declared dataset
- [x] 2.5 Each spec scenario bound to one test

## 3. Budgets app

- [x] 3.1 App skeleton and manifest: thirteen tables, two roles, ceiling and grants; built by `pnpm apps:prepare`
- [x] 3.2 Shared components in `packages/shop-floor`, with stories
- [x] 3.3 Server: save rules, ten operations, the actuals read
- [x] 3.4 Pages: P&L, budgets and a version, month close and adjustments, accounts, lines, rules, areas, follow-ups, a record's page
- [x] 3.5 Development seed of made-up data

## 4. Check

- [x] 4.1 Independent verifier against the #1380 checklist at 1280, differences fixed
- [x] 4.2 Both typechecks, the test workflow's jobs, code review of access rules, pasting and saving
