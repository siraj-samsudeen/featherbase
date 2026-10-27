## Why

The import screen can still lose or repeat work it was trusted with. Going back to choose sheets after one has been imported marks it as not imported, so it can be imported twice and its rows duplicated (#325). And when saved work is waiting for its file, dropping a different file throws that work away without a word (#326). Both break promises the import screen already makes.

## What Changes

- Once any table in a run has been imported, the sheet choice is fixed, and the screen says so.
- A file that doesn't match the saved work is held back. The user is told, and chooses between importing the new file instead and keeping the saved work.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spreadsheet-import`: the sheet choice closes after the first import, and saved work is never replaced by a different file without asking.

## Impact

The Admin import screen only (platform layer). No server, schema or storage change.
