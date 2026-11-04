## Why

The Feather Dash sales target report always shows the current month to date. On the 1st of a month the previous month's final result disappears, yet store staff and managers need it early in the next month (#750).

## What Changes

- A Month picker in the top bar offers this month (to date) and last month (whole). The choice is kept in the address as `?month=this|last`.
- Last month is read from its own cached copy, limited to the reader's places like this month's.
- The interactive report shows last month only when the pinned Dive caps its day at the period it is given (Sales Target Dive v14, data-warehouse#4630). Otherwise the page shows last month's cached table and says the interactive report can't show last month yet.
- No month older than last month.

## Capabilities

### Modified Capabilities

- `sales-target-report`: the reader chooses this month or last month.

## Impact

- `client-apps/jeyarama/dash`: `featherbase.json` (two datasets, the `months` read, the bar's Month picker), `src/report.ts`, `src/server.ts`, `src/page.ts`, `src/app.tsx`.
- data-warehouse#4630: Sales Target Dive v14, which the owner publishes.
