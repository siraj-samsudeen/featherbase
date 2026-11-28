## Why

An app like Forecasting reads a large slice of the warehouse: each month's official forecast run (lakhs of rows), and every morning's sales and stock. Staff must never query the warehouse themselves, and the app must sum and join these rows in Featherbase. Today an app's declared dataset is kept as one JSON value per row, which is fine for a short list and wrong for this. A Copied table (#772, #840) already copies a warehouse table into a typed table and refreshes it on a schedule, but it is an editable copy, row by row. The owner's ruling (27-Nov-2026): large data is a typed table by default, and one mechanism serves copies, app datasets and stand-ins (#1418).

## What Changes

- A Copied table has a **mode**: Editable (today, unchanged) or **Read-only**.
- An app's `datasets[]` entry becomes a Read-only copy by default: a typed Table in the app's own schema, with a composite key and exact numbers. `store: "json"` keeps today's JSON snapshot, for a stand-in or a prototype whose shape still moves. Dash's one dataset, and the dataset test fixture, say so.
- A Read-only copy is loaded **whole**, in bulk, from the declared query (with values from the run check), beside the current copy. Its checks run on the loaded rows; only then does it replace the current copy, in one step. A failed load keeps the last good copy.
- **Before every load** the source's columns are compared with the declaration: an extra column is ignored; a missing or retyped one stops the load, keeps the last good copy and raises the job's alert. A column added to the declaration is filled by the next load.
- Nobody edits a Read-only copy, and it is never sent to the warehouse by CDC.
- The copy's Scheduled Job (#840) checks every 15 minutes: it loads when the declared **run check** answers a new run, or at the declared **daily time**. The warehouse can ask for the check at once.
- After a new load, the app's declared job is told the previous and the new load, and can ask what moved by more than a share it chooses (10% unless it says otherwise).
- `ctx.datasets.active()` reads a Read-only copy's rows, through the reader's places, the same as a JSON snapshot.

## Capabilities

### New Capabilities

- `read-only-copies`: an app's warehouse data, copied whole per run, checked, swapped in one step and read by the app.

### Modified Capabilities

## Impact

- Platform: `table_copy` gains the mode, the query and the run check (migration); a bulk loader on Postgres `COPY`; the copy's storage (a view over loads kept apart from the app's tables); the copy job and an endpoint to run its check now; the app job's new-load context; the dataset read path.
- Apps: the manifest's `datasets[]` entry gains `store`, `rowKey`, `refresh` and `onNewLoad`. Dash takes a version step that keeps its dataset as JSON (no Table change).
- Warehouse: the capture skips Read-only copies with no change (they are not tables it is offered); an explicit rule is recommended in the hand-off. The warehouse worker may call the check endpoint after a build.
- Later, not here: stand-ins (#1409, PR 1416) loading through the same loader; moving today's JSON datasets; a System Manager creating a Read-only copy from the Admin.
