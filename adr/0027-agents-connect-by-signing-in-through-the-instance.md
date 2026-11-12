# ADR 0027: Agents connect by signing in through the instance, which issues ordinary access tokens

**Status:** Proposed · **Date:** 2026-11-12 · **Issue:** [#1207](https://github.com/siraj-samsudeen/featherbase/issues/1207) · **Change:** `openspec/changes/mcp-oauth-connect`

## Context and Problem Statement

ADR 0021 opened `/mcp` to access tokens only. Hand-made tokens make connecting an agent a
multi-step setup, and in practice push people to share a service account's token, so the agent
acts as the account rather than the person. MCP clients (Claude, Claude Code, ChatGPT and
others) can connect from a URL alone when the server implements the MCP authorization
specification: OAuth 2.1 with protected-resource and authorization-server metadata, dynamic
client registration and PKCE. Which party signs people in, and what credential results, is a
durable choice for the platform.

## Considered Options

- Each instance is its own OAuth authorization server, using its own sign-in, and issues
  ordinary person-owned access tokens that expire within an hour, renewed by rotating
  refresh tokens.
- Each instance is its own authorization server and issues signed self-contained tokens (JWT).
- An outside identity service is the authorization server, and the instance only checks its
  tokens.
- Keep hand-made access tokens as the only way in.

## Decision Outcome

Chosen: **each instance is its own authorization server and issues ordinary access tokens.**
A person connects a client by its `/mcp` address, signs in with the instance's own methods,
approves the client, and the client receives a person-owned access token that expires within
an hour, plus a refresh token that works once. The token belongs to a connection the person
can see and end. `/mcp` and the HTTP API treat it exactly like any other access token, so
ADR 0021 holds unchanged: one path to rows, the agent acts as the person, and history marks
the agent. Hand-made access tokens stay, for service accounts and automation.

### Consequences

- Good: connecting needs only the URL and the person's usual sign-in; the agent acts as that
  person, never as a shared account.
- Good: no second credential format; ending a connection, or disabling the person, stops the
  client at its next call.
- Good: no outside dependency per instance.
- Bad: the instance now runs an OAuth authorization server, a security-sensitive surface it
  must keep correct as the MCP specification moves.
- Bad: every short-lived token is a database row, created hourly per active connection; expired
  rows must be cleaned up.
