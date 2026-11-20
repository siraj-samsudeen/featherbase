## Why

The finance team builds the monthly store P&L by hand in Excel. A trial balance is given a P&L
line and a store row by row, manual lines are added, shared costs are spread across stores, and
the result is compared with a budget kept in another workbook. A budget is revised by saving
another file. Nothing links a figure to the rule or the manual line behind it, and nothing
stops a published month from changing.

They need one restricted place for the budgets and the working tables of the monthly close,
which shows the summaries they read in Excel today (#1380).

## What Changes

- A new Jeyarama app, Budgets (`client-apps/jeyarama/budgets`, served at `/budgets/`), open
  only to Budget Editors and Budget Viewers. Every table of it has an access ceiling, so a
  System Manager without one of the two roles reads none of it.
- Budgets held as versions: one amount for each version, store, month and P&L line. The budget
  for a month is the latest approved version covering it; a revision is a new version for the
  months it changes. A sales budget is held the same way, at subcategory.
- The monthly close: a close for each company, month and version, cut at the time the trial
  balance was downloaded, with its manual lines. Each line keeps its state, the SAP document
  that settled it and what remains.
- The close's rules: which P&L line and store rule each account has, the P&L's lines and
  subtotals, how shared costs are spread, and each store's area from a date.
- The P&L as the team reads it: stores by line for a month, one store across the year, and the
  bridge from budget to actual. Actuals are read from the warehouse and never stored.
- Three shared components for every app: FigureMatrix (a statement of figures), PasteRows
  (rows brought in from a spreadsheet) and FoldToggle (a row that folds others).

The data model, the two roles and the decisions taken while the owner was away are in
`docs/plans/budgets_app_data_model.md`.

## Capabilities

### New Capabilities

- `budgets-access`: who opens Budgets, and what a viewer can and cannot do
- `budget-versions`: budgets as versions that are approved, then revised, never edited
- `budgets-month-close`: a month's close, its manual lines and matching them to SAP
- `budgets-close-rules`: the accounts, lines and areas a close is worked out from
- `budgets-actuals`: actual figures read from the warehouse

### Modified Capabilities

None.

## Impact

- New app `client-apps/jeyarama/budgets`, built by `pnpm apps:prepare`. It is not yet listed in
  an instance: it installs only where the organisation's tables it links to exist.
- `packages/shop-floor`: FigureMatrix, PasteRows, FoldToggle, `fmtLakhs`, `pastedCells`.
- No platform behaviour changes.
