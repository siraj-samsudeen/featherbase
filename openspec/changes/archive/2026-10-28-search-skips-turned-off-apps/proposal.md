# Proposal

## Why

While any installed app was turned off, every search answered "permission
denied", for everyone, the Administrator included (#648). Search read every
Table, and reading one of the turned-off app's Tables refused the whole
request instead of being skipped. Admin's search bar lost its Records section
until the app was turned back on.

## What Changes

- Search leaves out the Tables of an app that is turned off, awaiting
  activation of an upgrade, or upgraded since the user's page loaded (which
  answered 409 the same way), and answers from every other Table as before.
- Turning the app back on makes its rows searchable again.

## Impact

- `apps/server/src/search.ts`: search skips a Table whose app
  refuses the request, instead of failing.
- Spec: `search-and-explore`, "Search only reaches what the user can read".
