# Proposal

## Why

The personalised sales-target report was built for a fixed experiment window (1–17 September 2026) and a handful of hand-assigned test accounts. To run it for real in a store, a Team Leader must open it and see the whole Section they lead, a Department Manager must see every Section they manage, and the figures must always be the current month to date. Until now a Team Leader saw only the few subcategories rostered to them personally — two of ninety for one Attakulangara Team Leader.

## What Changes

- Work out each reader's scope from the store's own roster, which is kept in Featherbase: the Sections a person leads or manages today, plus their own subcategories and any explicit assignment.
- Treat the roster as dated per Section, so a handover changes only the Section handed over.
- Follow a roster Section to every merchandise Section it covers.
- Report month to date in India time, rolling over at midnight, with a way to pin "today" for tests and demonstrations.
- Never serve a cached snapshot built for an earlier month.
- Group the report, and the live MotherDuck view it opens, by Section with a subtotal per Section, and say why the reader sees what they see.

## Capabilities

### New Capabilities

- `sales-target-report`: who sees which part of the month-to-date sales target report, and how it is grouped.

### Modified Capabilities

None.

## Impact

- Sales-target host, its report read and its dataset snapshot identity in `apps/server`; the report page in `apps/web`.
- Reads an optional DM employee code on the store roster; stores without it keep working.
- The embedded MotherDuck view receives one more optional starting value, the Section of each subcategory.
