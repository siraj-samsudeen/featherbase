# Proposal

## Why

A new instance replayed five months of database history to get started: 139
changes and one separate fix, including tables made and later removed, and a
long person-records report printed even on an empty database. Dev and prod are
about to be reinstalled for go-live, so this is the cheapest moment to start
every new instance from one clean starting point (#692).

## What Changes

- A new instance is built in one step from a starting point that produces
  exactly what the 139 changes built. The steps that depend on the instance's
  own settings (the first Administrator's password, Google sign-in for the
  local mock provider) still run after it, as before.
- An instance that already has all 139 changes (dev and prod today) is taken
  over without changing anything except removing the separate fixes' record.
  Any other database is refused before anything changes, naming the release
  that can upgrade it first.
- One-off fixes ("patches") go: database changes are the one way to change an
  instance. The single fix is part of the starting point.

## Capabilities

### Modified Capabilities

- `running-an-instance`: releases start new instances from one step, take over
  fully upgraded ones, refuse the rest; patches and the person-change grouping
  go.
- `trusted-runtime-packages`: the platform's storage promise no longer covers
  upgrading databases from before the platform had its own schema.

## Impact

Server migration runner, release and its preflight, the developer start-up
script and CI. Merging deploys nothing: an instance moves only when its client
repository picks up this platform version.
