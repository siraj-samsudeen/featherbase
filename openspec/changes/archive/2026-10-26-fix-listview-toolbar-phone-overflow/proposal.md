# Proposal

## Why

People using a phone can see only the first few actions in a Table's list because the header makes the Admin content area scroll sideways. The existing usable-on-any-device promise says lists fit a phone while only genuinely wide content, such as the rows table, scrolls within its own area.

## What Changes

- Let the ListView heading and complete action toolbar wrap or stack within a phone-width Admin content area.
- Preserve every metadata-gated action and the compact desktop arrangement.
- Add focused browser coverage at 375px and desktop width using metadata that activates the full toolbar.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes ListView's implementation of the existing `usable-on-any-device` requirement without changing that requirement.

## Impact

The generic ListView web component and its focused browser test change. No action behavior, metadata contract, API, dependency, or bulk-delete behavior changes.
