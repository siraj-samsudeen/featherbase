# Proposal

## Why

People using a phone cannot always reach Calendar's list view or its month controls because the header makes the page wider than the screen. The existing usable-on-any-device promise says every screen fits a phone, so Calendar needs to meet that promise.

## What Changes

- Let the Calendar header wrap or stack its title, month navigation, and list-view link at narrow widths.
- Keep the compact desktop header unchanged.
- Add focused browser coverage for a long Table title at phone and desktop widths.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This fixes Calendar's implementation of the existing `usable-on-any-device` requirement without changing that requirement.

## Impact

The Calendar web component and its focused browser tests change. No API, metadata, dependency, or product behavior changes.
