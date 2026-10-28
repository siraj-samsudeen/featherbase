# Proposal

## Why

A column's description — the line a form shows under it — could not be changed
by an app upgrade (#663). An earlier version's description could only be
fixed by resetting the app's history. Feather Dash shipped four descriptions
that say "material group" where its people say "subcategory", and needs a
later version to correct them.

## What Changes

- An app's new version can change a column's description, alone or together
  with another change to the same column, such as its label or a safe change
  of kind.
- A description change only changes what people read: it removes nothing,
  rewrites no row and leaves access as it was. The upgrade's preview says so.
- Installing that version directly and upgrading to it still give exactly the
  same tables.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: an upgrade can also change a column's
  description.

## Impact

The app manifest's column-change step accepts a description. No data
migration.
