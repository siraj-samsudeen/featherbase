# ADR 0028: An app's agent reads Featherbase with the caller's own credential

**Status:** Accepted · **Date:** 2026-11-27, accepted 2026-11-27 (Mohammad) · **Issue:** [#1377](https://github.com/siraj-samsudeen/featherbase/issues/1377) · **Change:** `openspec/changes/feather-ask-agent`

## Context and Problem Statement

Feather Ask is an app whose read runs an AI agent over Featherbase's MCP tools, as the person
who asked. The tools are the ones `/mcp` serves (ADR 0021): each tool call is an inner `/api`
request, here made by the server to itself, in memory. The read has already been authorized with
the credential the caller presented: their browser session, or an access token. How each inner
request says "as this person" is a durable choice.

## Considered Options

- Forward the caller's own credential (session or access token) on every inner request.
- Mint an access token for the person (a "pass", 5 minutes, kept in server memory).
- Mint a fresh session token for the person.
- Send no token: mark the inner request with the person in server memory, and add a front-door
  branch that checks them.

## Decision Outcome

Chosen: **forward the caller's own credential.** The read takes the credential its request was
authorized with (header first, then the `sid` cookie) and sends it as the Bearer header on every
tool call, inside `runAsAgent`, so history marks a change as made through an agent, labelled by
the app ("via Ask"). Every tool call passes the existing front-door check: refused once that
session is signed out or expired, the person signs out everywhere, is turned off, or loses the
sign-in method; a test-mode or preview session keeps its limits. A read the server starts itself
has no caller credential and gets no tools. The credential never goes into errors, logs, tool
results or the model's context; it stays inside the platform's tool helper.

This is not what ADR 0021 forbids. `/mcp` still opens only to an access token, and a browser
session sent to it from outside is still refused. Nor is it the token passthrough the MCP
specification forbids: that rule stops an MCP server handing a client's token to another service.
Here the credential was issued by Featherbase for Featherbase's own `/api`, and never leaves the
process.

### Consequences

- Good: the agent can do exactly what the person's own session can, no more; a leaked credential
  is the exposure every signed-in person already has.
- Good: no new way in. The front door is unchanged, and every existing session check applies,
  including signing out of that one session.
- Good: nothing is created, stored, renewed, cleaned up or shown on the Access Tokens page.
- Bad: the credential is threaded from the route down to the tools (`app-routes.ts` →
  `runPublicPackageRead` → `runPackageRead` → `executeRuntimeRead` → the tool helper).
- Bad: a question whose session ends mid-way gets refused lookups for the rest of it.
- Bad: a scheduled Ask, with nobody signed in, has no credential; it needs its own identity later.

### Rejected

- An access-token pass: a saved, visible credential for something that never leaves the server.
  It needed a cache, renewal, a sweep of expired rows, a column to hide it, and it survived signing
  out everywhere.
- A fresh session token: it would count as a fresh sign-in (and could be handed over as an Admin
  session), or need a new token format and key.
- No token, the person on the in-memory mark: sound, but a new front-door branch, and it would
  need its own session-id check to match signing out of one session.
