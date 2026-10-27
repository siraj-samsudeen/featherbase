# Proposal

## Why

Three faults in the row form, found before go-live, each lose or risk a person's work. A form script's on-load step could blank a row it was meant to adjust. A table whose rows are named by the person creating them could not get a new row from the form at all. And on a connected table that can't detect someone else's edit, the form saved over it without saying so.

## What Changes

- A form script's on-load step runs once the row has loaded, so it sees the saved values and changes only what it sets (#538).
- On a table whose rows are named by whoever creates them, the new-row form asks for that name, and a missing one is called out beside the field (#324).
- On a connected table with no last-changed time, an open row says that edits made elsewhere are not caught and that saving replaces what is there (#328).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `core-forms`: a form script's on-load step works on the loaded row.
- `naming-and-numbering`: the new-row form asks for a typed-in name.
- `external-data-sources`: a row that can be overwritten unnoticed says so.

## Impact

Web only: the row form. No server, schema or migration change.
