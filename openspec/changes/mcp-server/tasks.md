# Tasks

Scenarios first, then the server, one red-to-green step at a time (spec-as-source). Each fenced
scenario in `specs/agent-access/spec.md` is one Vitest test bound with
`scenarioFor(test, 'agent-access')` in `apps/server/test/scenarios/agent-access.test.ts`
(docs/TESTING.md "Spec scenarios"). It drives the real Hono app over HTTP with the SDK's own MCP
client, no browser. Binding the capability takes it out of the cucumber suite
(`acceptance-tests/cucumber.cjs`, through `tools/scenarios/bindings.cjs`). Design decisions are D1
to D8 in `design.md`; the owner approved them on 09-Nov-2026.

## 1. Setup

- [x] 1.1 Add `@modelcontextprotocol/sdk@1.32.2` (exact) to `apps/server` as a dependency, after
  checking with `npm view` that it is still the latest stable.
- [x] 1.2 Test driver in the scenario file: issue the user an access token through the API, connect
  the SDK `Client` with `StreamableHTTPClientTransport` to `/mcp` with that token (its `fetch`
  is the test app's), and wrap each tool call. Fixture: the "Customer" Table (required name,
  Retail/Wholesale type, city, contacts nested rows, a sensitive credit limit, change history on)
  with "Acme Traders", "Bala Stores" in Chennai and "Coral Mart" in Madurai, and a "Payroll"
  Table the user cannot read.

## 2. Scenarios: one bound test per scenario, each red for the right reason, then green

- [x] 2.1 Connect an agent with an access token: "The agent works as the user" and "Without a token
  the agent is turned away" (a signed-in browser cookie alone gets 401).
- [x] 2.2 History marks a change made through an agent: "A change through an agent is marked" and
  "A change by hand is not marked".
- [x] 2.3 A service account's agent acts as that account: "A service account's agent sees only what
  the account may read" and "A service account's change is marked".
- [x] 2.4 See the Tables the user can read: "A Table the user cannot read is not listed".
- [x] 2.5 Learn what a Table holds: "The agent learns how to fill a Table" and "A sensitive column
  stays unknown".
- [x] 2.6 Find rows with conditions: "Customers in one city" and "A page is capped" (250 rows,
  limit 500 asked, 100 returned, total 250).
- [x] 2.7 Open one row: "Opening a customer" (nested contacts included).
- [x] 2.8 Add a row: "A check refuses a bad row" (nothing added, the name named in the refusal).
- [x] 2.9 Change a row: "Moving a customer" (other values unchanged, history names the user).
- [x] 2.10 Delete a row: "Deleting without the right is refused".
- [x] 2.11 The agent's app knows which actions change data: "Deleting is flagged for approval"
  (the tool list's annotations).
- [x] 2.12 A refusal tells the agent what to fix: "An unknown column is named".

## 3. Server: the code the scenarios need, with integration tests in `apps/server/test/mcp.test.ts`

- [x] 3.1 Mount (D1): `src/mcp.ts` exports the handler; `index.ts` mounts `POST /mcp` before the
  GET catch-alls and answers `GET`/`DELETE /mcp` with 405; the SPA fallback's server-owned pattern
  gains `mcp`. Fresh `McpServer` and `WebStandardStreamableHTTPServerTransport` per request,
  stateless, `enableJsonResponse: true`. Test: `initialize` then `tools/list` round trip; a GET on
  `/mcp` is answered 405, not redirected or served the SPA.
- [x] 3.2 Authentication (D2): only an `fbt_` access token through `resolveToken`; a session JWT
  or `sid` cookie gets 401; an `Origin` outside `config.allowedOrigins` gets 403; a revoked token
  gets 401 on the next call; a Service Account token works. Test each.
- [x] 3.3 In-process dispatch (D3): one helper that sends a request to the app's own `/api` route
  with the caller's `Authorization` header and returns the parsed JSON or the error envelope. Test:
  a 429 from the owner's rate budget surfaces as a refusal.
- [x] 3.4 Read tools (D4, D7): `list_tables`, `describe_table` (only `readable_columns`, nested-row
  columns one level down), `query_rows` (filters, columns defaulting to readable non-nested
  columns, order_by, limit default 20 capped at 100, offset, include_retired; returns rows, total,
  offset, limit), `get_row`. Annotations read-only.
- [x] 3.5 Write tools (D4, D5): `create_row` (POST, insert-only), `update_row` (PATCH, only named
  columns), `delete_row` (DELETE); annotations as in D4.
- [x] 3.6 History mark (D8): `resolveAccessToken` keeps the token's id and label; the `/mcp` handler
  runs each inner request in the agent context; `recordVersion` and the retirement entry add
  `agent: { token_id, token_label }`; `documentActivity` returns it. Test: an entry written
  outside the context carries no mark.
- [x] 3.7 Refusals (D6): the error envelope becomes `isError: true` with `"<type>: <message>"` and
  one line per field, plus `structuredContent`; an unknown tool stays a JSON-RPC error.
- [x] 3.8 Tool descriptions: generated from the API's own constants (the filter operators, the
  100-row cap), never a per-Table text. Test: the operators listed equal the list API's.

## 4. Docs and hand-off

- [x] 4.1 README: `/mcp` in the source map, and "Connect an agent": issue a token, then the Claude
  Code and Codex config lines for a Streamable HTTP server with a Bearer header.
- [x] 4.2 `docs/DEPLOY.md`: a reverse proxy must pass `/mcp` to the API process.
- [x] 4.3 `CONTEXT.md`: add **Agent** (an AI assistant acting for a principal through an access
  token).
- [x] 4.4 ADR 0021 status set to Accepted with the approval date.

## 5. Completion

- [x] 5.1 `pnpm exec openspec validate mcp-server --strict` passes.
- [x] 5.2 The touched server test files, `pnpm --filter server typecheck`,
  `pnpm --filter web typecheck`, `pnpm check:scenarios`, `pnpm check:specs` and
  `pnpm check:platform-imports` pass; server coverage stays within the caps.
- [x] 5.3 By hand, the way a user would: boot the server, issue a token, and call `/mcp` with curl:
  `initialize`, `tools/list`, `tools/call` for `query_rows` and `create_row`, a token without
  permission refused, and the created row's history showing the agent mark. The commands go in the
  PR body.
- [x] 5.4 Sync the specs and archive the change (`pnpm exec openspec archive mcp-server --yes`).
