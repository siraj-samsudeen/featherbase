## Why

Warehouse tables declare no primary keys and no foreign keys: the StyleHR copy in the warehouse has none of either. Connected through Featherbase, such a table takes its first column as the row's id, unique or not, and has no links, so link titles, the relationship map, Explore's chains and picking a linked row by its name all show nothing. The StyleHR app (#808) therefore works only where the live HR database is reachable, which a hosted server is not until the HR system's database administrator allows its addresses (#876).

## What Changes

- An app that connects a table can say which column identifies its rows, and what each column links to. A linked column points at the other table's identifying column.
- What an app says must agree with what the source itself declares and never overrides it, so one description of the tables works against a source that declares keys and one that does not.
- An app whose key or link names a column that is not there or is left out, a table the source does not have, or contradicts the source is not installed, and nothing is connected.
- A second JeyaRama client app, StyleHR (warehouse), connects the same thirteen tables from the warehouse with the same table settings, key and links. The live StyleHR app declares the same key and links, which agree with its database.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`, in the order a person meets them: an app can say which column identifies a table's rows; an app can say what a column links to; an app whose key or link the source can't honour is not installed.

## Impact

- Reflect (`apps/server/src/sources/reflect.ts`): table settings gain `key` and `links`; they are checked with the other settings before any Table is created and laid over what the source declares.
- App install (`apps/server/src/apps.ts`): no change beyond the type; entries pass their settings through.
- New: `client-apps/jeyarama/stylehr-warehouse/` (manifest and README); `stylehr/app.json` gains its key and links; a server test keeps the two apps' table settings identical; `client-apps/jeyarama/CLAUDE.md` and the `connect-an-outside-database` guide describe the settings.
- Not here: removing rows the HR system deleted from the warehouse copy; choosing keys and links by hand on the Browse screen.
