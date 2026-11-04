## Why

When Siraj checked which Tasker build staging runs (#938), Admin → Apps showed the app's version but nothing else.
It didn't show which platform commit the instance runs, what changed in that app version, or which issue each change
came from. Answering "is the fix on staging yet?" meant opening the host's deploy page and reading git history.

## What Changes

- Admin → Apps shows **This build**:
  - the commit the server was built from, linked to it on GitHub;
  - that commit's title with its pull request linked;
  - when the server started;
  - a link to the changes up to this build.

  Railway names the commit on deploys from GitHub. A checkout reads it from git. Any other build says it doesn't
  know, rather than guessing.
- An app's manifest may carry **release notes**: what changed in each version, written by hand, newest first.
  Admin → Apps shows the latest three versions' notes under **What's new**, with each `#123` linked to its issue.
- Tasker 3.0.2 carries notes for 3.0.0, 3.0.1 and 3.0.2, with an empty migration from 3.0.1.
- Only System Managers see any of it, as with the rest of Admin → Apps (owner, 4-Nov-2026).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `app-management`: what a System Manager sees about the running build and each app's changes.
