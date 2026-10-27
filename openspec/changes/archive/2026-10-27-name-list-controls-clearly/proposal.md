# Proposal

## Why

Every Table's list had two controls with the same name side by side on a phone, six controls a screen reader could only call "unlabeled", and a new-row shortcut that opened "Page not found" on Admin pages that aren't a Table. Each one leaves a newcomer guessing or stuck.

## What Changes

- No two controls side by side share a name: the column picker and the way into the Columns screen now say which is which (#422).
- Every control has a name a screen reader can announce, including checkboxes and pickers that carry no visible text, and each row's checkbox names its row (#514).
- The new-row shortcut does nothing on an Admin page that is not a Table, such as Jobs (#515).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `usable-on-any-device`: controls are told apart from their neighbours and named for screen readers.
- `admin-ui-feedback`: the new-row shortcut does nothing away from a Table.

## Impact

Web only: the Table list and the Admin shell's keyboard shortcuts. No server, schema or data change.
