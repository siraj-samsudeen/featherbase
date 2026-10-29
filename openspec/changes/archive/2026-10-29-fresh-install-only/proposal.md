# Proposal

## Why

Dev and prod are wiped and installed fresh at go-live, like a developer's own
machine (owner's decision, 29-Oct-2026). So no instance will ever be upgraded
from before the starting point, and none will have an older Tasker installed.
The ways in for those cases (taking over an older database, refusing it with
the name of an older release, shipping old Tasker versions beside the current
one) will never run, yet every reader and every test run pays for them (#697).

## What Changes

- A fresh install is the only way in. A release onto a database that has no
  record of Featherbase's changes but is not empty is refused before anything
  changes, and told to use a new database. An installed instance just gets the
  changes it lacks, in order.
- Taking over a database installed before the starting point goes, with the
  promise that it is taken over.
- Old Tasker versions are no longer shipped beside the current one. The rule
  that an image ships the installed version beside a new one stays, for
  instances after go-live.
- The one-time command that moved StyleHR sign-ins from employee codes to
  record numbers goes, with the interim kind of sign-in it resolved: a fresh
  install links StyleHR by record number from the start.
- The promise that task work from before Tasker existed carries into it goes:
  no fresh install has such work.

## Capabilities

### Modified Capabilities

- `running-an-instance`: a release refuses a non-empty database it did not
  install; the takeover of older instances goes.
- `trusted-runtime-packages`: the carry-over of task work from before Tasker
  goes.

## Impact

Server migration runner, release and rehearsal, the image build, the developer
start-up script and CI. Merging deploys nothing: an instance moves only when
its client repository picks up this platform version.
