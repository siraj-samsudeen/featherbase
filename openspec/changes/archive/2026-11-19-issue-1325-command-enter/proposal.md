## Why

Pressing Enter in Search or Command opened the wrong thing, or "Page not found" (the UI consistency audit, finding F39, #1325). With nothing chosen, Enter opened an exact Table, else the first record, skipping the Pages group: "instance" opened a Scheduled Job, not Instance health. Pressed before the results arrived, or with no match, it went to `/featherbase/admin/table/<typed text>`. The bar also could not find What you can see, Service accounts or Log out.

## What Changes

- With nothing chosen, Enter opens a name typed exactly (a Table, a page), else the first result shown, in the list's own order: Commands, Pages, Tables, Create rows, Records.
- Enter pressed while results are still arriving waits for them and opens the first; with no match it stays put, and the bar says nothing matched. Enter never opens a guessed address.
- The account menu's pages are destinations: What you can see (your own access page), and, for a System Manager, Service accounts (Access tokens on that tab). Log out is a command.

## Capabilities

### New Capabilities

### Modified Capabilities

- `admin-ui-feedback`: Enter opens the first result shown, never a guessed address; the account menu's pages and Log out are found.
