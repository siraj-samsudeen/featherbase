## Why
Opening a table cannot currently apply an authored default filter or show its preferred related list immediately. Display labels are also ignored by several table navigation surfaces. Users repeatedly filter and expand the same relationship.

## What Changes
- Add optional, validated `browse_presentation` metadata with initial filters and a preferred direct reverse-reference connection.
- Show initial filters visibly; explicit URL filters (including `[]`) override defaults.
- Open the preferred relationship inline without overriding subsequent user actions.
- Persist an optional table display label and use it without renaming canonical table identifiers or storage.

## Capabilities
### Modified Capabilities
- `list-view`: metadata-driven initial browsing and displayed table names.

## Impact
One nullable metadata column, generic table-definition APIs and existing Admin components. No business-row migration, new permission, retirement lifecycle or per-model platform code. Tracked in #879.
