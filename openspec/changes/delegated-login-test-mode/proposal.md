# Proposal

## Why

Rolling out the sales-target report (JeyaramaGroup/data-warehouse#3783) means opening it **as** each Team Leader and Department Manager to check that their Sections and figures are right. Their StyleHR passwords are theirs, so during the trial there is no way to sign in as them through the connected service.

## What Changes

- A deployment switch, set only in the server's environment, that makes the connected service's sign-in skip the service: a linked person signs in by their ID alone.
- Everything that decides *whose* account opens is unchanged: the ID must be linked to exactly one enabled, non-privileged account.
- Because the service is not asked, it cannot say the person has left. While the switch is on, a leaver is refused only when their account is disabled — which the roster sync does for anyone StyleHR shows as having left.
- The sign-in page says plainly that test mode is on and does not ask for a password.

## Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: adds test mode to sign-in through a connected service (change `delegated-password-login`).

## Impact

- `apps/server/src/delegated-login.ts`, the `/api/login/delegated` route and `/api/brand` in `apps/server/src/index.ts`; the sign-in form in `apps/web/src/pages/Login.tsx`.
- Meant for a trial instance only. Turning it off is removing the variable.
