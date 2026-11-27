## Why

When an app is built, some of its data is often not in the warehouse yet in the
right shape: it exists only as a CSV or a workbook. The app's screen then shows
nothing until the warehouse model lands, so people cannot see the real screen,
and building the app and landing its data block each other (#1409). Test
fixtures have been used in the gap, unmarked and unavailable on a hosted
instance.

## What Changes

- Each dataset an app declares is bound, per instance, to the warehouse (as
  today) or to a **stand-in**: rows with the same columns, loaded from a CSV.
  The binding is instance data, and the settings file can set it per
  environment.
- A System Manager, or an agent acting for one, checks a CSV against the
  dataset's declared columns and loads it as the dataset's rows. The app reads
  them exactly as it reads warehouse rows.
- Stand-in rows are always marked: in the answer the app gets, on any page that
  showed them (drawn by the platform, not the app), and in the record of who
  viewed what.
- Switching to the warehouse runs the real refresh and needs no change to the
  app. The first real refresh compares with nothing, so sample figures never
  stand in the way of real ones.
- On production a stand-in needs a System Manager's say for that dataset.
- A Datasets page in the Admin lists every app's datasets and where each is
  served from.

## Capabilities

### New Capabilities

- `stand-in-datasets`: serving an app's dataset from a loaded file until the
  warehouse has it, marking it everywhere, and switching to the warehouse.

### Modified Capabilities

None. `instance-settings` already promises that the file sets an instance's
managed settings per environment; the binding joins them.

## Impact

- `apps/server/src/dataset-snapshot.ts`, `app-datasets.ts`,
  `jobs/refresh-datasets.ts`: a stand-in is a snapshot the engine knows.
- New `apps/server/src/dataset-stand-in.ts` (check, load, switch, list), a
  `Dataset Binding` system Table with its controller and migration, routes in
  `app-routes.ts`, and `mcp-dataset-tools.ts`.
- `apps/web`: the stand-in line in the Admin shell and the shared bar, and the
  Datasets page.
- `instance-settings.ts` and `packages/shared`: the binding is a managed Table.
- A fixture app, `test-apps/fixtures/stand-in-proof`, with one warehouse and
  one stand-in dataset.
