## Why

Tables connected from an outside database read as machine names: "Public Store Store", "Reported To Id", and links shown as bare numbers ("2037") where a person expects a name. A builder can only fix the names by hand afterwards, and links to connected rows can't be fixed at all (#783).

## What Changes

- On the Browse screen, each table about to be connected shows its proposed name in a box the user can change.
- A column that points at another table is labelled by what it points at ("Reported To", not "Reported To Id").
- A connected row shows its title wherever Featherbase shows a row by its title (the relationship map, Home, Recent), and only to people who may read that row.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `external-data-sources`, in the order a person meets them: naming tables as they are connected; link columns named after what they point at; links to connected rows showing titles.

## Impact

- Browse screen (`apps/web/src/pages/SourceBrowser.tsx`): an editable name per table.
- Reflect (`apps/server/src/sources/reflect.ts`, the reflect action): accepts a name per table; link labels drop the trailing "id".
- Row titles (`apps/server/src/row-titles.ts`): a source-bound Table's titles are read through its scoped list.
- Not here: Table labels and renaming (#777), titles for join tables (#779), choosing title and list columns on connect (#796; its Browse-screen name box is delivered here).
