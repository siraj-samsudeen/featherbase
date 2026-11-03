## Why
Repeated imports must not erase corrections people made by hand. Issue #626 settles field-level protection and explicit conflict resolution.

## What Changes
- Preserve hand edits, show incoming conflicts, and allow keeping a correction or adopting the source.
- Preview updated/kept fields, preserve the same rule through the API, and close conflicts on undo.

## Capabilities
### New Capabilities
None.
### Modified Capabilities
- `spreadsheet-import`: field-level protection and conflict resolution.
- `import-history-and-undo`: undo closes conflicts without restoring values never changed.

## Impact
Platform import action, history attribution, metadata-generated conflict storage, wizard and Table list. No user Table columns.
