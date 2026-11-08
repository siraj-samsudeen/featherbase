## Why

Dash could open one Dive, and worked out who sees what from copies of the store org chart it kept itself. Every new report needed code. Dash now opens any Dive listed in its own report list, works out each person's reach from the core Tables, and sends each Dive only the filters that reach allows (#967).

## What Changes

- Dash keeps one Table of its own: the list of Dives it can open, each with the shape of filters it takes.
- Reach comes from the core Tables: a person's current job assignments, their sites, sections and subcategories.
- The sidebar lists the reader's reports; the store and month pickers appear only on reports that take them.
- A report taking no filter opens for someone given it whose job reaches no store.
- The old rules, which read Dash's own copies of rosters and sections, are gone.

## Capabilities

### New Capabilities

- `dash-reports`: which reports a reader is offered, what each Dive is sent, and what the page says when a report can't open.

### Modified Capabilities

- `sales-target-report`: the rules that read Dash's own rosters and section maps are removed; reach now comes from the core Tables.

## Impact

- Dash 0.12.0, with the platform's outbound read `prepare`, bar pickers that follow an address key, and a scope provider's unmarked core Tables.
- The 14 copied Dash Tables are dropped on upgrade.
