# Proposal

## Why

Some readers' sections span two stores — a Department Manager named on the roster of a section in one store and another section in a second store, or a person an administrator assigns a second store. Today the report refuses them outright (`multiple_stores`), and an administrator's second-store assignment row saves fine and then silently breaks that person's report (#409). The owner ruled on 23-Oct-2026: a two-store reader is legitimate, and reads one store at a time with a store switcher.

## What Changes

- The reader's scope becomes one assignment per store. `GET /api/sales_target/me` lists every store the reader can open (`stores`: code, name, Sections, reasons) and names the default store.
- `/report` and `/embed_session` take an optional `store` parameter. It must be one of the reader's own stores; anything else, or a repeated parameter, is refused with 403. Without it, or empty, the default store is used. `/me` takes no store.
- The Access Log records the store each report opening was limited to.
- Default store: the one with the most Sections; a tie goes to the lowest store code.
- The report page shows a store dropdown when the reader has two or more stores; switching reloads the report and the live Dive for that store, and the choice is remembered per viewer on the device.
- The `multiple_stores` refusal and its neutral card are removed.

## Capabilities

### Modified Capabilities

- `sales-target-report`: a reader may have several stores (change `sales-target-section-scope` had made one store per reader the rule).

## Impact

- `apps/server/src/sales-target.ts`, `apps/server/src/sales-target-report.ts`, `apps/web/src/pages/SalesTarget.tsx`.
- A single-store reader sees no change. An ambiguous employee code still blocks the reader (person-resolution D10). Nothing changes in the data warehouse.
