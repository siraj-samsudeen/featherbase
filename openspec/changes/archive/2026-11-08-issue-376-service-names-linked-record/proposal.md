## Why

A StyleHR sign-in finds the account by its linked StyleHR ID, and StyleHR's yes was trusted whoever it named. If StyleHR ever handed that ID to another employee before the roster caught up, the wrong person could open the account (#376). Only links made at a roster first sign-in (#970) were held to their record.

## What Changes

- A connected service's settings can say where its answer names the person's record. When they do, every sign-in through that service is refused, as for a wrong password, unless the answer names the record the account is linked to. The activity log names the link, and an answer about somebody else who has left disables nobody.
- Dash's StyleHR method says so: StyleHR names the record as `employee_id`, the record number every StyleHR link carries.
- A malformed setting is refused on save, and refuses sign-ins rather than stop checking.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: a sign-in through a connected service is held to the linked record.

## Impact

- `apps/server/src/delegated-login.ts`, `apps/server/src/controllers/sign-in-method.ts`, `client-apps/jeyarama/instances/dash/instance-settings.json`. No migration.
