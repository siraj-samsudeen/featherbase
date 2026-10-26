# Proposal

## Why

When every administrator is locked out of an instance, there is no way back in short of editing the database by hand. The emailed reset needs mail, which the hosted instances do not have, and setting someone else's password needs an administrator who can still sign in (#391).

## What Changes

- An operator with shell access to the server can set a new password for any person. The password is read from standard input only, never from the command line, and never printed.
- The reset signs the person out of every session that was open before it, revokes any reset link emailed to them before it, and leaves an Activity Log entry attributed to the operator shell.
- Access tokens are a separate credential and keep working; the operator is told how to list and revoke them.
- The command refuses a password on the command line, one typed at a terminal, an unknown person, a service account, and a password shorter than the usual minimum.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: Add the break-glass password reset from the server.

## Impact

- A new operator command in `apps/server` (`cli set-password`), the password write it shares with the other routes, session checking, and the emailed-reset write.
- One new nullable column on the person record (migration 0104): the moment their sessions were last ended.
- `docs/DEPLOY.md` gains a "Locked out" runbook entry.
