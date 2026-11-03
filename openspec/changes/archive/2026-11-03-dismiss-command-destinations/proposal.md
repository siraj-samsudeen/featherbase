## Why

Selecting a destination from the command bar can leave its dropdown covering the page the user just opened (#822).

## What Changes

- Dismiss the command dropdown after destination activation, including the current destination.
- Keep past-search replay available for editing and resubmission, and preserve navigation history and existing commands.
- Keep the current presentation and keyboard access unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-ui-feedback`: dismiss completed destination choices without dismissing search replay.

## Impact

The Admin command bar's activation handlers and public browser regression coverage. No route, API, permission or history-storage changes. Coordinate shared-file edits with #821 and #775; do not import their unpublished changes.
