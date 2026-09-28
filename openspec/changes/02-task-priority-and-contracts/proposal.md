# Task priority and reliable API contracts

## Why

People need to distinguish urgent tasks from routine work. Existing records must survive the introduction of required fields, and API consumers need dependable types and validation.

## What Changes

- Add optional priority, then backfill missing values and require priority in storage.
- Let users see and change priority; reject unsupported values.
- Provide derived client types, runtime input/output validation and generated API documentation.

## Capabilities

### New Capabilities
- `task-priority`: Priority values and safe populated-data upgrades.
- `api-contracts`: Typed, validated and discoverable JSON operations.

### Modified Capabilities
None; these capabilities extend `basic-todos` additively.

## Impact

Depends on `01-basic-todos`. Requires two ordered schema revisions and the engineering constraints introduced for this release. IDs, titles and deletions remain intact.
