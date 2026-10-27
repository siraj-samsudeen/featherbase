# Proposal

## Why

An administrator looking back at a sign-in can see who signed in, when and how, but not from where: the network address is left empty on every sign-in (#396). An instance's privacy notice cannot promise to keep the address until it is recorded.

## What Changes

- Every sign-in records the network address it came from, whichever way the person signed in: password, a connected service, Google, sign-up, the hand-off between an instance's addresses, or a preview link.
- The address is the one the server can trust: the connection itself, or behind a listed proxy the last address that proxy saw. An instance whose edge has no fixed addresses to list, such as Railway's, can name one header that its edge overwrites with the client's address. The address a caller writes into a forwarded header is never believed.
- The limits on repeated sign-in attempts count by the same address.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: each sign-in records where it came from.

## Impact

Platform layer: the sign-in pipeline and the pre-auth limiter (`pre-auth-rate-limit.ts`, `sign-in.ts`, `auth.ts`, `index.ts`), and one new optional instance variable, `CLIENT_ADDRESS_HEADER`. No migration: the Activity Log already has the column.

The instance steps are not part of this change. Each instance sets the variable and checks it as docs/DEPLOY.md describes. Its privacy notice, an instance setting, can then promise the address again.
