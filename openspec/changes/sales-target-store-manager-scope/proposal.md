# Proposal

## Why

The sales-target report (JeyaramaGroup/data-warehouse#3783) scopes Team Leaders and Department Managers to the Sections they run. A Store Manager runs the whole store and has no Section on the roster, so today they open an empty report. Each store's manager is already known: one person per store, with a StyleHR employee code and a store mailbox (`sm.atk@jeyarama.com`) they can sign in with through Google.

## What Changes

- A Store Manager Table in the Store Sections app names the manager of each store (store code, employee code, name, email).
- A reader whose employee code is a store's Store Manager sees every material group that store's merchandise map holds, grouped by Section, and is told they see it as Store Manager.

## Capabilities

### Modified Capabilities

- `sales-target-report`: adds the Store Manager scope (change `sales-target-section-scope`).

## Impact

- `apps/server/src/sales-target.ts` (scope derivation); the reason label in `apps/web/src/pages/SalesTarget.tsx`.
- The Table is optional: an instance without it behaves as before.
