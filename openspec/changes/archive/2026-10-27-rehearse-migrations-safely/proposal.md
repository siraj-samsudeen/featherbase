# Proposal

## Why

Before a release that rewrites the trial's data, the operator rehearses it on a restored copy (docs/DEPLOY.md): every pending database change runs in one transaction that is always rolled back. Two gaps make that rehearsal untrustworthy or risky:

- On a copy taken before the platform moved into its own schema (0094), the rehearsal ran each change differently from the release and failed where the release would succeed (#557).
- A copy of production is stamped `production`, so the environment check cannot tell it from live production. A rehearsal pointed at the live database by mistake held every change's locks until the end and blocked the instance's users (#558).

## What Changes

- The rehearsal applies each pending change the same way the release does, older copies included, and refuses what the release refuses.
- The rehearsal refuses a database that other sessions are connected to, because a restored copy has none and a live instance always has its server's. `--allow-live` overrides the refusal.
- Inside the rehearsal, a change that would wait more than 2 seconds for a lock fails instead, and no single statement runs for more than 5 minutes.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `running-an-instance`: rehearsing a release on a copy.

## Impact

`cli migrate:rehearse` (`src/migrate-rehearse.ts`) and the migrator (`src/migrate.ts`), which now share one per-batch apply step. No migration, no new setting.
