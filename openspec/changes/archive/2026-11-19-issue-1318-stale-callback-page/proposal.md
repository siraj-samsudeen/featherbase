## Why

A sign-in callback opened again (Back to it, an old tab, a replayed link) has no sign-in cookie. The overnight test of 19-Nov-2026 opened `/api/oauth/microsoft/callback?code=x&state=y` that way and got a bare JSON page (#1318). A browser that names its navigation already lands on the sign-in page; a client that names neither a page nor JSON got the JSON error.

## What Changes

- The return from Google or Microsoft (the callback) answers a refusal with the sign-in page and its plain reason unless the caller asks for JSON, or is a browser fetch. A client that names neither now lands on the sign-in page too.
- A caller that asks for JSON, or a browser fetch, keeps the error response and status it had. Starting a sign-in keeps today's rule.

## Capabilities

### New Capabilities

### Modified Capabilities

- `sign-in-and-accounts`: a refused return from the provider is a page unless the caller asks for JSON.
