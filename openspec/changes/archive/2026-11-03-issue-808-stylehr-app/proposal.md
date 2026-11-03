## Why

JeyaRama's HR system (StyleHR) was made browsable in Featherbase by hand on one local instance: a read-only data source, thirteen connected tables given readable names, personal and tax columns removed, and the column each row is read by and the list columns chosen table by table. None of it exists anywhere else, so every new instance would repeat it, and one missed step shows a person's date of birth or tax number (#808). An app can already bring a data source and the tables to connect, but not how each table reads.

## What Changes

- An app that connects a data source's tables can say, for each table, the name it gets, the column its rows are read by, and the columns its list shows. What it leaves unsaid keeps the defaults connecting picks (#783, #796).
- An app can name columns of a table to leave out. They are never connected, so no instance using the app can read or show them.
- An app that names a column a table does not have, or names a left-out column as its title or a list column, is not installed and connects nothing, so a misspelt column can never let personal data through.
- A JeyaRama client app, StyleHR, connects the HR system's thirteen store, floor, section, employee, deployment and organisation tables this way, with personal and tax columns left out. The connection string is never in the repository: each instance sets the variable the app names.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`, in the order a person meets them: an app can choose how each table it connects reads; an app can leave a table's columns out; an app naming a column a table can't offer is not installed.

## Impact

- App install (`apps/server/src/apps.ts`): each `sources[].reflect.tables` entry may be a table name or an object carrying its name, left-out columns, title column and list columns.
- Reflect (`apps/server/src/sources/reflect.ts`): applies those settings when it creates each Table, and refuses a column the table lacks before creating any.
- New: `client-apps/jeyarama/stylehr/` (a manifest-only app and its README); `client-apps/jeyarama/CLAUDE.md` notes it; the `connect-an-outside-database` guide describes the new settings.
- Not here: the Browse screen offering these settings by hand; a warehouse-backed StyleHR source; reports over the HR tables (#785).
