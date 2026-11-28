## Why

Forecasting's `carry_changes` job, told of each new forecast run (#1418), must find whom to tell that a subcategory moved: who answered it on the earlier run (the app's own answers Table) and the store's manager. An app's job could read none of the app's own Tables, and the answers Table keeps each person's rows private. Siraj ruled on #1428 (28-Nov-2026, "yes"): an app's own job may read every row of the app's own Tables, read-only, declared in the app's manifest, past their row privacy, only for the app's own Tables.

## What Changes

- A job declares `readsAllRows: ["<app>.<table>", …]`: its own app's stored Tables or read-only copies, never another app's or the platform's. A Table named there is read whole, every person's rows, read-only.
- The job reads them with `ctx.documents.list(table, { filters, limit })` and `ctx.documents.get(table, id)`. A Table it did not name is refused and recorded, like any undeclared access.
- An upgrade cannot add a Table to a kept job's `readsAllRows` (a job cannot gain access in an upgrade); a new job's preview lists it.
- An app's **validators** and **jobs** read the instance Tables the app declares in `baseTables.read`, the same helper its reads and actions have: only the declared columns, of Tables the instance links, read-only. The design session confirmed (28-Nov-2026) that this falls within Siraj's approval of the app reading those Tables with its own access.

## Capabilities

### New Capabilities

### Modified Capabilities

- `trusted-runtime-packages`: what an app's job may do.

## Impact

- Platform: the job declaration, its load-time check, `ctx.documents.list/get` for jobs, the upgrade rule; `baseTables` in validator and job contexts.
- Forecasting: `carry_changes` names `forecasting.forecast_line_review` in `readsAllRows` and finds the Store Manager through `baseTables`; its save validators check the writer's section the same way.
