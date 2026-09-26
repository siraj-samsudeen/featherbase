## Why

Six open UI issues make destinations ambiguous, preferences race, text hard to read, import omissions easy to miss, Reference proposals invisible and generated controls inaccessible by label. Resolve exactly #67, #96, #97, #109, #163 and #293 together without changing server authorization, reflection, schema or storage.

## What Changes

- Distinguish commands, Table lists, new rows and records in awesomebar results.
- Serialize theme/palette writes and restore the last confirmed preference on failure.
- Separate link/status text from accent roles and check AA text contrast across palettes and modes.
- Put an amber multi-sheet warning naming used/ignored sheets immediately below the builder dropzone.
- Expand SourceBrowser columns to show source types, FK edges and conditional Reference proposals.
- Associate generated form and sub-table controls with stable IDs and accessible names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-ui-feedback`: destination descriptions, settled preferences, role contrast, sheet warning and column previews.
- `core-forms`: generated control label association.

## Impact

Web presentation and preference hooks, focused tests and OpenSpec artifacts. Source introspection adds a read-only `reference_table` proposal to existing column metadata; reflection and driver types remain unchanged. No new dependencies, endpoints, schema, storage, authentication or permission behavior. Excludes #158, #255, #294 and broad import consolidation. The baseline commit contains only characterization and traceability comments.
