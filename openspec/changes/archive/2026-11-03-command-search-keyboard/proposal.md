## Why

Typed command-bar results cannot be reached with arrow keys (#827). Users need to choose any matching destination or action without leaving the keyboard.

## What Changes

- Plain Up/Down chooses results in display order, with visible and accessible selection; Enter activates the chosen result.
- Preserve default Enter behavior before selection, recents, editable past searches, Escape, reopening and immediate destination dismissal.
- Do not offer records from a previous query while its replacement is being searched.
- Leave modified-arrow editing shortcuts native; no new Cmd+Arrow shortcut is introduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-ui-feedback`: choose typed command-bar results with the keyboard, without activating stale matches.

## Impact

AdminLayout command-bar selection and its public component/browser tests. No API, permission, canonical identity, history storage or route changes. Base: merged #824 on origin/main 39cdf97e. Coordinate with #821 and #826 without importing unpublished work.
