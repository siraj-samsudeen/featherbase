## Why

People read the MotherDuck data warehouse under their own MotherDuck usernames, and nobody could tell from Featherbase who a username belongs to (#1346). MotherDuck adds and switches off its users on its own, so a hand-kept note goes stale.

## What Changes

- MotherDuck Accounts: one record per MotherDuck user, kept in step daily from MotherDuck's own list, the way the roster keeps employees in step with HR. Nothing is ever deleted.
- Each account is Active, Deprovisioned or Removed, with the day it was removed.
- An account is linked to its person when exactly one person has its email. For every other account a person uses, a ticket asks the MotherDuck reviewer to link it, and closes once it is linked.
- Search finds an account by its username or its email.

## Capabilities

### New Capabilities

- `motherduck-accounts`: who uses each MotherDuck account, kept in step with MotherDuck.

### Modified Capabilities
