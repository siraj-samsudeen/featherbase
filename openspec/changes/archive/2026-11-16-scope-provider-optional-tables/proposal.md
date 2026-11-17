## Why

A scope provider can't read a Table that some instances don't have yet. One failed read refuses that person's whole scope, and the health check fails while any listed Table is missing. So an app can't ship code that reads a new Table before every instance has it. Dash's Buyer Sections (#1246) need exactly that: report scope follows Buyer Sections where the Tables exist, and today's Merchandise Assignment everywhere else (#1247).

## What Changes

- A scope provider's `documents` gains `available(table)`. It answers whether the provider may read that Table now. A missing Table answers no and contributes nothing; it never widens anyone's scope. Reading it anyway is refused as before.
- `available` is a read like the others: one at a time, and only while the provider runs.
- A manifest may list `scopeProvider.optionalTables`, a subset of `tables` that excludes the app's own Tables. The health check names a missing optional Table without failing.

## Capabilities

### Modified Capabilities

- `instance-health`: a missing optional Table is named, not a fault.
- `transactional-runtime-actions`: a scope provider can ask whether a Table can be read now.

## Impact

- No Table, grant or data changes. The manifest schema accepts `scopeProvider.optionalTables`.
