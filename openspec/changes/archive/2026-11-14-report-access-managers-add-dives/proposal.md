## Why

A buyer who manages report access was blocked on production: Dives he built after 12-Nov never reached the bundle pickers, because only a System Manager can turn a Dive into a Dash report. Giving his role that right was impossible too: an upgrade that widens a role's access is refused, so every such fix waited for the owner at his computer. The owner, on 14-Nov-2026, wants the person who gives reports to be the one who brings them in, with no second role and no approval step (#1169).

## What Changes

- An app upgrade applies the access its new version declares, new or wider, for roles the app itself declares. A grant to everyone, to signed-out visitors, to a platform role or to a role the app doesn't declare is still refused. Every grant an upgrade adds is listed in its preview and the deploy log, and written to the activity log.
- An app can declare a dataset that holds nothing about stores. Every read gets all of its rows; the app's own read rules decide who may ask.
- Dash's Report access page gains Add a Dive: a Report Access Manager searches the organisation's Dives, or pastes a Dive's link, names it and adds it. It becomes a report taking no filter, ready to give or bundle at once.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: an upgrade may widen access for the app's own roles.
- `app-roles-store-access`: data an app doesn't split by store is read whole.
- `dash-reports`: a Report Access Manager adds a Dive as a report.

## Impact

- Platform: the upgrade's access check and the dataset declaration. Production's Dash 0.13.1 upgrades to 0.13.2 on the next deploy, giving Report Access Manager the right to create reports.
- Dash 0.13.2: one dataset over MotherDuck's Dive list, one outbound read, one action, the Add a Dive card.
- Store-filtered Dives still need a System Manager in Admin: they need the Dive's own state keys.
