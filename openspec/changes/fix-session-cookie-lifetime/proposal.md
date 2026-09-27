# Proposal

## Why

Featherbase promises to keep a user signed in for the administrator's configured session length, but cookie-only features stop recognizing the user after a fixed seven days. Matching the cookie to the issued session lets private files and realtime updates keep working for the whole session, whether it is shorter or longer than seven days.

## What Changes

- Give every newly issued browser session a cookie lifetime equal to that session's configured lifetime.
- Apply the same lifetime to password, Google, and preview sign-in.
- Preserve the cookie's existing HttpOnly, SameSite, and path protections.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `sign-in-and-accounts`: Clarify that every browser credential remains valid for the configured session length across all sign-in methods.

## Impact

- Session issuance and `sid` cookie creation in `apps/server`.
- Server authentication, OAuth, and preview-sign-in tests.
- No API, database, dependency, or client UI changes.
