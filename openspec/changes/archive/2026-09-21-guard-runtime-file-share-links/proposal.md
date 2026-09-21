## Why

Runtime deletion ignores core File and Share document pointers. An administrator
can create those links even when an application's UI does not expose them.

## What Changes

- Add files and shares to the existing retention counts and refusal fields.
- Serialize runtime-target File/Share creates and moves with guarded deletion.
- Preserve caller permissions, admission, replay and existing retention semantics.

## Capabilities

### Modified Capabilities
- `runtime-document-deletion`: name and preserve core attachment/share links.
- `transactional-runtime-actions`: expose additive files/shares retention counts.

## Impact

Generic document save and retention helpers, shared types and isolated proofs.
No migration, Tasker change, private route or arbitrary-column scanning.
