## Why

The current release cannot upgrade the production-era database at commit
3a6770ff651a308bfae0e31b5c525705c356a5a5. Its ledger ends at 0087 and platform
storage is still in public; today's SQL adapter targets featherbase in 0088,
before 0094 moves those relations. A disposable exact-commit reproduction
fails with the same missing featherbase.table_def error as production.

## What Changes

- Execute the immutable pre-convergence SQL against its legacy storage until
  the ordered schema move commits; retain per-migration atomic ledger writes.
- Define the supported legacy upgrade floor as all migrations through 0087,
  rejecting older or incomplete legacy ledgers before mutation.
- Add executable fresh, exact-production-era upgrade, retry, and rejection proofs.
- Preserve shipped migration files and ordinary current-schema SQL routing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: make the legacy upgrade floor and ordered,
  retryable convergence explicit under platform_storage_is_explicit.

## Impact

Migration runner and migration regression tests only; no production access,
reset, deployment, package installation, or historical migration edits.
