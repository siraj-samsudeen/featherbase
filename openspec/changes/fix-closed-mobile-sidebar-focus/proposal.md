# Proposal

## Why

When the Admin sidebar is closed on a phone, keyboard focus still moves through
its offscreen links. Keyboard users therefore lose sight of focus before they
can reach the visible page.

## What Changes

- Remove the closed phone drawer and its controls from keyboard navigation.
- Keep every drawer link reachable when the drawer is open.
- Keep the static desktop sidebar reachable by keyboard.
- Add responsive keyboard coverage for all three states.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `usable-on-any-device`: Clarify the existing keyboard promise for controls
  that are hidden in a closed panel and become available when it opens.

## Impact

The shared Admin layout and its responsive browser coverage change. There are
no API, data, dependency, runtime-app, or shared-style changes.
