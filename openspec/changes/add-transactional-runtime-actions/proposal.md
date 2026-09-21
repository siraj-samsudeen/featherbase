## Why

An application command that creates a destination and moves or deletes a source
cannot safely compose separate HTTP writes. Trusted packages need a declared,
caller-authorized transaction boundary with durable replay after a lost response.

## What Changes

- Add versioned, app-scoped named actions, one authenticated host endpoint, and
  permission-preserving document helpers inside one admitted transaction.
- Store successful results and request fingerprints atomically with writes.
- Defer document post-commit effects until the outer action commits.
- Expose declared action names to managers; no private routes or SQL capability.

## Capabilities

### New Capabilities
- `transactional-runtime-actions`: declared atomic commands, replay and lifecycle admission.

### Modified Capabilities
- `runtime-document-deletion`: generic runtime deletes enforce the same revision
  and retained-activity guard instead of bypassing it.

## Impact

Runtime discovery, document transaction composition, database migration, manager
diagnostics, and authenticated API routing. No Tasker files or shared databases.
