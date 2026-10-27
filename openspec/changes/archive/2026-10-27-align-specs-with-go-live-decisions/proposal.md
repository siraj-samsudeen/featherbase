# Proposal

## Why

The overnight audit on #504 found three places where a spec promised something the product does not do, and the owner decided on 27-Oct-2026 that the product is right each time. Specs are the only behaviour authority, so a reader who trusts them today is misled about dashboards on app data, about "rows I own" on a connected table, and about what the Sales Target page says when its live report is down.

## What Changes

- Dashboard counts and charts may reach an installed app's data while the app is on, limited by the person's own permissions; a turned-off or unavailable app's data stays out of reach (#521).
- A "rows I own" permission on a connected table is accepted when it is saved, and every read or write through it is then refused, so nothing is disclosed (#543).
- When the Sales Target live report is unreachable, the page shows one plain sentence and a way to try again; it no longer says "this is not a sales figure" (#565).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: dashboards reach an app's data only while the app is on.
- `external-data-sources`: a "rows I own" grant on a connected table saves, then refuses every use.
- `sales-target-report`: the live report fails with a plain message and a retry.

## Impact

Specs only; no code change. Two server tests are added or tightened so each reworded promise is pinned by a test.
