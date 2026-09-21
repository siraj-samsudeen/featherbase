## Context

See `proposal.md`. Runtime-app HTML is served by the server before the Featherbase
SPA loads. The server can observe path and query, but an HTTP request never carries
the browser fragment. Password sign-in completes inside the Featherbase SPA, where
the login page can observe both its `next` query parameter and its own fragment.

## Goals / Non-Goals

**Goals:**
- Keep the return contract generic across independently installed runtime apps.
- Preserve exact safe path/query bytes through the server handoff and preserve the
  inherited browser fragment through the client handoff.
- Keep one fail-closed validator for post-login navigation.

**Non-Goals:**
- No Tasker-specific route or selected-task parsing in Featherbase core.
- No change to runtime package APIs, authentication, or app asset authorization.
- No fragment fabrication or fragment storage on the server.

## Decisions

1. **The server puts only the observed app path and query in `next`.** The app-root
   matcher already establishes ownership. Encoding that exact local destination
   avoids losing nested paths and encoded query state. The redirect deliberately
   has no fragment, allowing normal browser redirect behavior to retain the
   original fragment on the login URL.
2. **The login client combines validated `next` with the inherited fragment.** If
   `next` already contains a fragment (for example, a client-side API 401 handoff),
   that explicit fragment wins; otherwise the login page's current fragment is
   appended. The server is never treated as if it received hash state.
3. **Return validation is allow-list based.** Accept only same-origin canonical
   `/featherbase/...` destinations (excluding login itself) or paths matching the
   shared direct runtime-app root contract. Reject external/scheme-relative URLs,
   backslashes, malformed percent encoding, technical roots, and legacy human
   routes. Falling back to the account landing page is safer than repairing input.

Alternatives rejected: session storage would couple separate tabs and OAuth flows;
putting a fragment into the server-generated `next` would invent state the server
cannot observe; accepting every same-origin path would reopen technical and legacy
roots as post-authentication redirect targets.

## Risks / Trade-offs

- **Browser redirect fragment behavior varies if a Location supplies a fragment**
  → the server Location supplies none, and a real browser journey checks inheritance.
- **Over-validation can strand valid apps** → use the same shared app-root pattern as
  runtime discovery and proxy routing, with asymmetric nested/encoded-query tests.
- **Malformed paths can throw during decoding** → decoding is guarded and refusal is
  tested at both server navigation and client return boundaries.

## Migration Plan

Ship server and web changes together. Rollback restores root-only return behavior;
no data or schema migration is involved.
