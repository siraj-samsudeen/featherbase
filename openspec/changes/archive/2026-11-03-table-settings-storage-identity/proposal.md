## Why

Table settings identify SAP Plant by its module instead of its own name. SQL authors also cannot see the authoritative location of its rows without reading server code.

## What Changes

- Set Table's default title to its natural name through a normal metadata migration, preserving effective authored title overrides and the existing shared fallback.
- Show copyable, read-only storage identity on saved Table definitions, resolved by the server for local, app-owned, Settings and connected Tables.
- Do not show a warehouse destination without an authoritative configured mapping. Featherbase currently has no such mapping contract; this change adds no CDC integration or configuration.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tables-and-fields`: identify a Table and copy its authoritative storage location from its settings.

## Impact

Issue #860. Table metadata, title-column permission normalization, the existing metadata response and generic form are affected. Existing storage resolvers, source bindings, permissions and authored titles remain authoritative. No shared fallback change, new dependency, warehouse connection or per-Table component.
