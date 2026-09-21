## Why

Featherbase currently remembers only a runtime application's root when a signed-out
deep link passes through sign-in. The browser therefore loses the app path, query,
and fragment that identify the user's exact destination, contradicting the governed
route contract and making links to selected work unreliable.

## What Changes

- Carry the exact safe runtime-app path and query into canonical Featherbase login.
- Preserve the browser-only fragment across sign-in without pretending the server
  received it.
- Validate login return destinations as same-origin canonical Featherbase or direct
  runtime-app paths, rejecting technical, legacy, external, ambiguous, or malformed
  destinations.
- Prove generic deep-link return and selected-work restoration without hard-coding
  Tasker into Featherbase routing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `trusted-runtime-packages`: Strengthen the canonical human-route requirement so
  signed-out runtime-app navigation returns to the exact safe path, query, and
  browser fragment after sign-in.

## Impact

Runtime-app navigation middleware, login return validation, login completion,
server/web routing tests, and the browser login journey. No package API, storage,
or Tasker product behavior changes.
