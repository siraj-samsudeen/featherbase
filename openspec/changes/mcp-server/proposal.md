## Why

People already ask agents (Claude Code, Codex, any MCP client) to look things up and tidy data, but
an agent can reach Featherbase today only by hand-writing calls against the REST API. With an MCP
endpoint, a person connects their agent once with their own access token, and the agent finds,
reads and changes rows the way that person could: the same permissions, the same refusals, the
same checks and automations, and every change in history under that person's name (#1083).

## What Changes

- The API server answers the Model Context Protocol at `/mcp`, on the instance's own address, in
  the same process (owner's decision). Transport: Streamable HTTP, stateless, through the official
  `@modelcontextprotocol/sdk` (1.32.2, the latest stable).
- Only an access token opens it (`Authorization: Bearer fbt_…`). The agent acts as the token's
  owner, never as a superuser. A browser session or cookie is refused there.
- Seven tools, the same for every Table and derived from Table metadata, never one per Table:
  list Tables, describe a Table, query rows (filters, sort, pages), get a row, create, update and
  delete a row. Reads and writes from day one (owner's decision).
- Each tool call is served by the existing HTTP API in-process, so permissions, Data Scope,
  sensitive columns, the trigger chain in one transaction, realtime updates and rate limits apply
  unchanged.
- Every change made through `/mcp` is marked in the row's history as made through an agent, with
  the access token's label, while the token's owner stays the actor (owner's decision).
- A Service Account's token opens `/mcp` too; its agent acts with only that account's roles
  (owner's decision).
- Read tools are marked read-only; update and delete are marked destructive, so the agent's app
  asks the person first. A refusal comes back to the agent as a readable tool error naming what to
  fix. A query returns at most 100 rows per page.

## Capabilities

### New Capabilities

- `agent-access`: connecting an agent with an access token, what the agent can then find, read
  and change in Tables on its person's behalf, and how history marks its changes.

### Modified Capabilities

None. A token already acts as its owner (`access-tokens`), and saves, deletions and permissions
keep their own promises (`tables-and-fields`, `row-deletion`, `permissions-and-roles`); this change
adds a new way in, not new rules for them.

## Impact

- `apps/server`: a new `mcp` module and the `/mcp` mount in `index.ts`; history entries
  (`document.ts`, `document-activity.ts`) gain an optional `agent` mark in their JSON `data`, no
  schema change; ahead of the GET catch-alls
  (legacy redirect, app addresses, SPA fallback, whose server-owned list gains `mcp`).
- New dependency `@modelcontextprotocol/sdk@1.32.2` (zod 4 and Hono are already in the server).
- Docs: README's source map and a short "connect an agent" section; `docs/DEPLOY.md` notes that
  `/mcp` must reach the API process behind any proxy.
- Sequencing: the issue asks for this after the OpenAPI description (#1084). Nothing here depends
  on it; when #1084 lands, the tool descriptions can be checked against it.
- Out of scope: building or changing Tables, row actions (submit, cancel, amend, rename, workflow),
  import with its undo (owner's decision, 09-Nov-2026: a later change), showing the agent mark in
  the Admin's timeline (a UI change, its own UI route), files, comments, reports, MCP resources
  and prompts, the MCP OAuth sign-in flow, a local stdio launcher, and narrowing a token below its
  owner.
