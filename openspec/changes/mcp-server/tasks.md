# Tasks

Acceptance first, then the server, one red-to-green step at a time (spec-as-source). The scenarios
in `specs/agent-access/spec.md` drive the real server over HTTP with the SDK's own MCP client, no
browser. Design decisions are D1 to D7 in `design.md`; ADR 0021 goes from Proposed to Accepted once
the owner approves the design.

## 1. First-time setup

- [ ] 1.1 Skipped: `acceptance-tests/` already exists. Add `@modelcontextprotocol/sdk@1.32.2` to
  `acceptance-tests/package.json` (devDependency) and to `apps/server` (dependency), exact version.
- [ ] 1.2 `acceptance-tests/support/pages/agent.js`: an agent driver that issues the user an access
  token through the API, connects the SDK `Client` with `StreamableHTTPClientTransport` to the
  stack's `/mcp` with that token, and wraps each tool call. Fixture: the "Customer" Table (required
  name, Retail/Wholesale type, city, contacts nested rows, a sensitive credit limit) with "Acme
  Traders", "Bala Stores" in Chennai and "Coral Mart" in Madurai, and a "Payroll" Table the user
  cannot read.

## 2. Step definitions: one per pending step, each red for the right reason, then green, then commit

- [ ] 2.1 Connect an agent with an access token: "The agent works as the user" (history shows the
  user) and "Without a token the agent is turned away" (a signed-in browser cookie alone gets 401).
- [ ] 2.2 See the Tables the user can read: "A Table the user cannot read is not listed".
- [ ] 2.3 Learn what a Table holds: "The agent learns how to fill a Table" and "A sensitive column
  stays unknown".
- [ ] 2.4 Find rows with conditions: "Customers in one city" and "A page is capped" (250 rows,
  limit 500 asked, 100 returned, total 250).
- [ ] 2.5 Open one row: "Opening a customer" (nested contacts included).
- [ ] 2.6 Add a row: "A check refuses a bad row" (nothing added, the name named in the refusal).
- [ ] 2.7 Change a row: "Moving a customer" (other values unchanged, history names the user).
- [ ] 2.8 Delete a row: "Deleting without the right is refused".
- [ ] 2.9 The agent's app knows which actions change data: "Deleting is flagged for approval"
  (the tool list's annotations).
- [ ] 2.10 A refusal tells the agent what to fix: "An unknown column is named".

## 3. Server: the code the steps need, each with its integration test in `apps/server/test/mcp.test.ts`

- [ ] 3.1 Mount (D1): `src/mcp.ts` exports a Hono handler; `index.ts` mounts `POST /mcp` before the
  GET catch-alls and answers `GET`/`DELETE /mcp` with 405; the SPA fallback's server-owned pattern
  gains `mcp`. Fresh `McpServer` and `WebStandardStreamableHTTPServerTransport` per request,
  stateless, `enableJsonResponse: true`. Test: `initialize` then `tools/list` round trip; a GET on
  an app address is not redirected.
- [ ] 3.2 Authentication (D2): only an `fbt_` access token through `resolveToken`; a session JWT
  or `sid` cookie gets 401; an `Origin` outside `config.allowedOrigins` gets 403; a revoked,
  expired or disabled-owner token gets 401 on the next call; a Service Account token works. Test
  each.
- [ ] 3.3 In-process dispatch (D3): one helper that sends a request to the app's own `/api` route
  with the caller's `Authorization` header and returns the parsed JSON or the error envelope. Test:
  a tool call spends the owner's rate budget, and a 429 surfaces as a refusal.
- [ ] 3.4 Read tools (D4, D7): `list_tables` (from `/api/navigable_tables` plus each Table's label
  and description), `describe_table` (from `:meta`, only `readable_columns`, nested-row columns one
  level down), `query_rows` (filters, columns defaulting to readable non-nested columns, order_by,
  limit default 20 capped at 100, offset, include_retired; returns rows, total, offset, limit),
  `get_row`. Annotations read-only. Tests: Data Scope narrows a query, a sensitive column is absent
  from describe, query and get.
- [ ] 3.5 Write tools (D4, D5): `create_row` (POST, insert-only), `update_row` (PATCH, only named
  columns), `delete_row` (DELETE); annotations as in D4. Tests: the trigger chain runs (a
  controller's check refuses inside the save and nothing is written), history names the token's
  owner, a realtime update is published, a system-written Table refuses.
- [ ] 3.6 Refusals (D6): the error envelope becomes `isError: true` with `"<type>: <message>"` and
  one line per field, plus `structuredContent`; an unknown tool or malformed message stays a
  JSON-RPC error. Test: permission, validation, not-found and conflict cases.
- [ ] 3.7 Tool descriptions: generated from the API's own constants (the filter operators, the
  100-row cap) and Table metadata, never a per-Table text. Test: the operators listed equal the
  list API's.

## 4. Docs and hand-off

- [ ] 4.1 README: `/mcp` in the source map, and "Connect an agent": issue a token, then the Claude
  Code and Codex config lines for a Streamable HTTP server with a Bearer header.
- [ ] 4.2 `docs/DEPLOY.md`: a reverse proxy must pass `/mcp` to the API process.
- [ ] 4.3 `CONTEXT.md`: add **Agent** (an AI assistant acting for a principal through an access
  token).
- [ ] 4.4 ADR 0021 status set to Accepted with the approval date, before the PR merges.

## 5. Completion

- [ ] 5.1 `pnpm exec openspec validate mcp-server --strict` passes.
- [ ] 5.2 `pnpm --filter server test test/mcp.test.ts`, `pnpm --filter server typecheck` and
  `pnpm check:platform-imports` pass.
- [ ] 5.3 Full acceptance suite (`npm --prefix acceptance-tests test`): every scenario passes, no
  pending or undefined steps, HTML report generated.
- [ ] 5.4 By hand, the way a user would: `./init.sh`, issue a token, connect Claude Code to
  `http://localhost:<API_PORT>/mcp`, list Tables, query, create, update and delete a row; record
  the commands in the PR body.
