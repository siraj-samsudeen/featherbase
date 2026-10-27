# Proposal

## Why

Every app must let its people read its starting table, or the app will not open
for them. Reading any table also opened the administration, so everyone who could
open an app was offered the administration and could browse it (#659). Feather
Dash's store and team managers would all have met it, which its design never
intended.

## What Changes

- A grant on an installed app's own tables, or a row of one shared with a person,
  no longer opens the administration to them. This holds whether the app is
  switched on or off.
- People who only use apps are no longer offered the administration, and the
  administration refuses them as it refuses anyone without access. Signing in
  takes them to their app.
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
