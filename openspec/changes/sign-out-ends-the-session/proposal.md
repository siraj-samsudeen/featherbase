# Proposal

## Why

Signing out is supposed to end the session, but today it only clears the browser's copy. Anyone holding the same session — copied from a shared phone or a log — can keep using it for up to eight hours after the owner signed out. A person who signs out on a shared shop-floor phone needs that sign-out to be real.

## What Changes

- Signing out ends that session everywhere it is used: ordinary requests and live updates both stop accepting it at once.
- Only the session being signed out ends. The same person stays signed in on their other phones and browsers.
- Integration access tokens are unaffected.
- Sessions opened before this change cannot be signed out this way, so they end when it is deployed and everyone signs in once more.
