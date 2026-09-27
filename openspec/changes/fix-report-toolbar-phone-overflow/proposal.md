# Proposal

## Why

People using a phone cannot reach every Report control because its toolbar makes the Admin content area scroll sideways. The existing usable-on-any-device promise says the page must fit the screen, so the Report view needs to meet it.

## What Changes

- Let the Report title, export actions, view link, column picker, grouping and saved-report controls wrap at narrow widths.
- Keep the established compact desktop toolbar layout.
- Add focused browser coverage at phone and desktop widths that proves every toolbar control is reachable and the Admin content area does not scroll sideways.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes the Report view's implementation of the existing `usable-on-any-device` requirement without changing that requirement.

## Impact

The Report view component and its focused browser test change. No API, report calculation, metadata, dependency, or interaction-design changes.
