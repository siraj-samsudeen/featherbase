# Proposal

## Why

The generic row form cannot delete a fresh row owned by an installed app because it omits the revision that the server requires. Users should be able to delete the row they opened while still being protected when someone else changes it first.

## What Changes

- Send the loaded row revision when the generic form deletes any row that has one, including local app-owned rows.
- Keep source-bound deletion behavior unchanged.
- Verify that a fresh app-owned row is deleted and that a stale loaded revision is refused without deleting the newer row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `row-deletion`: Refuse a deletion when the row changed after the user opened it.

## Impact

The generic web form's delete request and its focused PostgreSQL-backed component coverage change. The server delete contract, app ownership lifecycle, source-bound behavior, authorization, storage and dependencies remain unchanged.
