## Why

Builders must not lose access to data by editing a Table definition. Invalid links and repeated values should be refused with useful explanations before go-live.

## What Changes

- Refuse a uniqueness rule when existing values repeat, naming the column and repeated value.
- Refuse missing link targets when saving a definition, while allowing self-links.
- Resolve the owner decision for omitted columns and ambiguous rename-shaped edits before implementing #250/#251.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: safe definition edits and useful validation refusals.

## Impact

Platform Table-definition save path and HTTP regression tests. No data migration is currently needed; no new schema or client-specific behavior.
