# Proposal

## Why

Every app must let its people read its starting table, or the app will not open
for them. Reading any table also opened the administration, so everyone who could
open an app was offered the administration and could browse it (#659). Feather
Dash's store and team managers would all have met it, which its design never
intended.

## What Changes

- An installed app's tables don't count towards the administration only when
  that app opens at its own root, with pages of its own (decision of
  28-Oct-2026, provisional, on Siraj's list). A grant on such an app's tables, or
  a row of one shared with a person, no longer opens the administration to them,
  whether the app is switched on or off.
- An app without pages of its own is used through the administration's generated
  lists and forms, so its tables keep counting and its people keep the
  administration.
- People who only use apps with pages of their own are no longer offered the
  administration, and the administration refuses them as it refuses anyone
  without access. Signing in takes them to an app they can open: the one their
  address opens, else the first by title among the apps a role of their own
  opens. An app open to everyone never claims a person with no role of use.
- Whether an app has pages of its own is what its installation declared, never
  whether its files loaded at the last restart; when that cannot be read, its
  tables are treated as the app's.
- The app itself is unchanged for them: it opens, and its tables answer them as
  before.
- Grants on the instance's own tables open the administration as before, and
  System Managers keep it. Someone who uses the administration for another reason
  still finds an app's tables listed there.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `permissions-and-roles`: an app's own tables do not open the administration.

## Impact

Server: the one rule for "can use the administration". Web: the shell, the bar
and the account menu read only that rule. No data migration.
