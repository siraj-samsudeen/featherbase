# Proposal

## Why

When a data source is down, a save that sets a link to one of its tables can't check that the linked row exists. The owner decided on 27-Oct-2026 (#566, following #535) that such a save is refused rather than written unchecked, so every link still points at a real row.

## What Changes

- The spec states that a save which sets a link to a connected table is refused while that table's data source can't be reached. Saves that don't set such a link are unaffected.
- A test pins it. The code already behaves this way since #535.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`: a link to a connected table is refused while its source is down.

## Impact

Spec and test only. No code change.
