# ADR 0021: Agents reach Featherbase through the HTTP API, over MCP, with an access token

**Status:** Accepted · **Date:** 2026-11-08, accepted 2026-11-09 · **Issue:** [#1083](https://github.com/siraj-samsudeen/featherbase/issues/1083) · **Change:** `openspec/changes/mcp-server`

## Context and Problem Statement

Agents (Claude Code, Codex, any MCP client) should work on Featherbase data the way a person does.
The owner decided on 08-Nov-2026 that they read and write from day one, through an `/mcp` endpoint
inside the API server. What remains durable is how that endpoint relates to the rest of the
platform: what authenticates it, and whether it gets its own path to rows.

## Considered Options

- Tools call the row engine directly, with their own permission and trigger handling.
- Tools are served by the existing HTTP API in-process, one generic set derived from Table metadata.
- One tool per Table, generated from metadata.

## Decision Outcome

Chosen: **the MCP endpoint is a thin layer over the existing HTTP API.** Each tool call is one
in-process request to an existing `/api` route, carrying the caller's own access token, so there
is one path to rows for the Admin, scripts and agents. The tools are generic (list, describe,
query, get, create, update, delete) and take the Table as an argument; no tool is written or
generated per Table. Only an access token opens the endpoint, a Person's or a Service Account's,
and it acts as its owner; a browser session never does. History keeps the owner as the actor and
marks each change made this way as made through an agent, with the token's label.

### Consequences

- Good: a new check on a route applies to agents the day it lands; there is nothing to keep in step.
- Good: an agent can never do more than its token's owner, and revoking the token stops it.
- Good: a reader of a row's history can tell an agent's change from the owner's own.
- Bad: a capability the HTTP API lacks cannot be offered to agents without adding it to the API
  first.
- Bad: each tool call pays for one in-memory HTTP round trip and one token lookup.
