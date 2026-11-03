## Why

People should be able to read and share Table addresses without encoded spaces, without changing the names they know. Table and row addresses must not accidentally open a builder or another tool.

## What Changes

- **BREAKING**: give Admin Table destinations an explicit `table/<kebab-table>` namespace, with separate `row/<encoded-id>`, `new`, and Table-tool destinations.
- Resolve Table segments through metadata before reading, checking access, editing or saving; keep names and labels unchanged.
- Generate the same kebab spelling in portal, print and other Table destinations. Keep row IDs, app IDs and query values intact.
- Migrate internal links and executable journeys together; add no old-route aliases, redirects or stored slugs.
- Refuse new cross-Table URL spelling collisions consistently through creation, rename, import, reflection and app installation/upgrades. Leave existing collisions untouched and ambiguous; do not trim, merge or backfill identities.

## Capabilities

### New Capabilities

- `table-addresses`: readable, unambiguous Table destinations with unchanged resource identity.

### Modified Capabilities

None. Existing access, naming, list, form and printing promises remain in force.

## Impact

Shared normalization and URL generation; server resolver and generated notification/feed links; web routes, Table consumers, recents and internal links; Tasker's advanced-row destination; acceptance and browser test navigation helpers. No database migration or layout redesign.
