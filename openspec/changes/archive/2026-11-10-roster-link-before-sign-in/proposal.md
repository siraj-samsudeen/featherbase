## Why

A StyleHR employee got an account only at their first StyleHR sign-in (#970). Until then an administrator could not open their access page, and staging's test mode refused them. Siraj decided on 10-Nov-2026 that every current employee is linked before they sign in (#1157).

## What Changes

- A scheduled job, `link_roster` (and `cli roster:link <method> [--apply]`), links every current row of the method's staff roster: it makes the account, the sign-in link and the employee identifiers, and marks the row as theirs. An existing account is matched, never duplicated.
- It ends the sign-in link of anyone the roster no longer marks current, and closes the identifiers a roster wrote. Accounts are kept.
- First-sign-in creation stays, for anyone who joins between runs.
- Dash's instance settings switch the job on.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: staff on the roster are linked before their first sign-in, and a leaver's link ends.

## Impact

- `apps/server/src/roster-link.ts`, `jobs/link-roster.ts`, `cli.ts`, migration 0157.
- Security is unchanged: a link signs nobody in by itself. Outside test mode the HR system still checks the password and must name the link's record.
