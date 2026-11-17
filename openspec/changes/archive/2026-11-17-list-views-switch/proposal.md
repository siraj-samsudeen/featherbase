## Why

Siraj (17-Nov-2026, #1259) wants a list and its record side by side, as Front does, and chose to keep three ways of reading a list with a switch each person sets: today's Table, a List And Record split for queues, and a Table With Panel for data tables.

## What Changes

- Every Table's list offers three views, switched by three icon buttons beside its title: Table, List And Record, Table With Panel.
- One record panel serves List And Record and Table With Panel: the record's title and subtitle with its actions at the top, its properties as chips, its fields, and its activity.
- The choice is remembered per person per Table; a saved view keeps its own view.
- Data tables open on Table With Panel; a Table marked as a queue opens on List And Record.
- At phone width the list is a Table and a row opens its own page.

## Capabilities

### Modified Capabilities

- `list-view`: three views and a per-person switch.
- `saved-views`: a saved view keeps its view.

## Impact

`apps/web` (ListView, ListRows, a new RecordPanel, the drill pane), `apps/server` (saved views, Table metadata), one migration (`saved_view.layout`, `table_def.queue`). The per-person choice uses the existing user settings.
