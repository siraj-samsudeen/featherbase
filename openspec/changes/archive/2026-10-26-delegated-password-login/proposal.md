# Proposal

## Why

Some people who need Featherbase have no Google account and no Featherbase
password, but already sign in every day to another system the organisation
trusts — for the Jeyarama Group, store Team Leaders and their HR system,
StyleHR. Letting them use that same ID and password, checked by that system,
gets them in without a second password to issue, remember or reset.

## What Changes

- An administrator can connect one outside sign-in service in System
  Settings: the name people know it by, the address Featherbase asks to check
  a password, and which User column holds each person's ID in that service.
  Leaving the address blank keeps the feature off.
- When connected, the sign-in page offers a second, clearly named way in
  ("Sign in with StyleHR") that asks for the person's ID in that service and
  their password.
- Featherbase forwards the ID and password to that service once, never stores
  or logs the password, and signs in the one enabled account linked to that
  ID — with the same session, landing page and cookie a password sign-in
  gives.
- A wrong password, a service that is not answering, and a correct password
  with no linked account each get a different answer, so nobody is told their
  password is wrong during an outage.
- Repeated attempts are slowed by the same limits as password sign-in.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: adds signing in through a connected outside
  service, linking accounts to IDs in that service, telling an outage apart
  from a wrong password, and extends who may sign in to cover the new method.

## Impact

- `apps/server`: three new System Settings columns (migration), a new public
  sign-in route, the public brand response gains the service's name, and a
  provider call with an injectable fetch for tests.
- `apps/web`: the Login page gains the second sign-in form; the API client
  gains its call.
- Docs: `docs/DEPLOY.md` explains how to turn it on for StyleHR.
- No new dependencies. Nothing changes for instances that leave it off.
