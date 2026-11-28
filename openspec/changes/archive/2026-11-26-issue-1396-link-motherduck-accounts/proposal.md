## Why

The MotherDuck sync (#1346) raised one ticket for each account it could not link
by email: 67 on production. Linking them one ticket and one form at a time is
slow. Siraj and RB want to map most of them in one sitting (#1396).

## What Changes

- A System Manager screen, MotherDuck Accounts › Link to people. It lists accounts
  to link, linked ones and service accounts. Each shows the people its username
  reads as (the same match the tickets name) as one-click choices, plus the
  normal Person picker.
- A choice saves the account's Person at once, through the normal row save; Undo
  clears it again.
- Close their tickets now queues the MotherDuck sync, which already closes the
  ticket of every linked account.

## Impact

- `apps/server/src/motherduck-accounts.ts`, `apps/server/src/people-routes.ts`:
  the screen's list and the queue call.
- `apps/web/src/pages/LinkMotherDuckAccounts.tsx`, the router and the Admin sidebar.
