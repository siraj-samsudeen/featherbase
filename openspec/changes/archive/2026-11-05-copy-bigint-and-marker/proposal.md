## Why

Two edges of copied warehouse tables failed with no useful message (#932). A BIGINT value past 2^53 refused the whole copy with a generic "Value out of range" error. Renaming the deleted-at-source marker through Columns broke every later Copy again.

## What Changes

- A copy, or Copy again, that meets a whole number past the exact range is refused. The message names the column, the value and the row, and no rows change. A BIGINT inside the range still copies as a number.
- While a Table is copied from a data source, its deleted-at-source marker cannot be renamed or removed.

## Capabilities

### Modified Capabilities

- `external-data-sources`: two refusals for copied tables.

## Impact

`apps/server/src/sources/table-copy.ts` and `apps/server/src/table-engine.ts`; tests are in `apps/server/test/table-copy.test.ts`.
