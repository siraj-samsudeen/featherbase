## Why

The platform's "What can this person see" page (#628) lists the places an
app's scope gives a person, with the reasons the app gives. Feather Dash, the
first scope app, gave none, so every place read "no reason given".

## What Changes

- Each place Feather Dash gives a person carries the job assignments behind
  it as reasons: "Team Leader job assignment" from its first day, and to its
  end day when it has one. An acting assignment says "Acting".
- A place from the old rules, for a store not yet live, says which old rule
  gives it, for example "Store Manager, by the old rules", with no days.
- The places themselves, their filters and `basis` are unchanged.

## Capabilities

### Modified Capabilities

- `feather-dash-people`: a person's places say why they have them.

## Impact

- `client-apps/jeyarama/dash/src/provider.ts` and `coverage.ts`. No version
  change here; it ships in Feather Dash's next release PR.
