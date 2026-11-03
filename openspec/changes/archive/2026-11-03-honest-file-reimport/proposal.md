## Why

Re-importing an identical file claims every matched row will change, while another line says nothing changes. People need to distinguish real changes, retained corrections and intentional appends before committing a file.

## What Changes

- Make matching-mode wording agree with the chosen key.
- Split matched rows into changed and unchanged, with changed-column totals; separately show rows retaining corrections and new conflicts.
- Require typed confirmation only above 20 changed rows, not unchanged matches.
- Offer remembered and full one-to-one matching keys for explicit acceptance; warn and require acknowledgement before a full-overlap append.
- Preserve existing permissions, comparison rules, save lifecycle, source observations and undo. Keep historical processed counts distinct from value-change counts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spreadsheet-import`: honest re-import preview, explicit key suggestions and deliberate append safety.

## Impact

Issue #851. Generic ImportWizard, import-run aggregation, collection import dry runs and import-corrections planning; existing HTTP/browser and acceptance tests. No new dependencies, provenance schema, database transaction changes, copy engine, scheduled refresh or warehouse access. #772/#840 remain separate work.
