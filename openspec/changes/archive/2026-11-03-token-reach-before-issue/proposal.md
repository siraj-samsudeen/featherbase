## Why

#852: a service account created in Access tokens starts with no role of its own,
and its token was issued with no hint of that. The first API call then failed
with "No read permission". A token could also be issued with no expiry without
any prompt.

## What Changes

- The Issue access token dialog says what the token will reach before it is
  issued: the Tables its owner can read and change, or every Table for a
  System Manager. The figures come from the server's own permission check
  (`GET /api/access_tokens/reach`), so the built-in All role counts.
- It warns, without blocking, when the owner holds no role of its own or can
  read no Table.
- A token that never expires is issued only after a second, deliberate press.
- Out of scope: recording what a service account is for, and per-Table grants
  without roles (#852 item 1), queued as a design question in #770.

## Impact

- New `apps/server/src/token-reach.ts` and the `GET /api/access_tokens/reach`
  route, which follows the same rule as issuing: your own reach, or anyone's
  for a System Manager.
- `apps/web/src/pages/AccessTokens.tsx` issue dialog.
