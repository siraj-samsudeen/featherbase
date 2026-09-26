# Proposal

## Why

People editing a Table's columns on a phone cannot reach its rename action without moving the whole Admin page sideways. The approved usable-on-any-device promise already covers this, so the existing screen needs to meet it.

## What Changes

- Keep the Columns editor table's wide content inside its own horizontal scroll area.
- Add a browser regression check that the page does not scroll sideways at phone width and that Rename remains reachable.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change implements the already-approved product-wide phone usability requirement without changing it.

## Impact

- `apps/web/src/pages/ColumnEditor.tsx`
- Focused Column Editor browser coverage
