## Technical plan (for the builders)

The standard MCP authorization flow (spec 2025-06-18; the MCP SDK's client `auth()` in
`@modelcontextprotocol/sdk/client/auth.js` is the reference client and the test driver).
`origin` below is `externalOrigin(c).origin` (session-cookies.ts): the address the client used
(design D12).

**Data** (one migration, next free number on `main`):
- `agent_client`: a self-registered client. `id` (`cli_…`), `client_name`, `redirect_uris text[]`,
  `created_at`.
- `agent_connection`: one Allow. `id` (`con_…`), `person` (→ person, cascade), `client_id`,
  `client_name`, `return_place` (`loopback` or the `https` origin), `created_at`, `last_used_at`,
  `ended_at`, `ended_reason`.
- `agent_auth_code`: `code_hash` (pk), `client_id`, `person`, `redirect_uri`, `code_challenge`,
  `return_place`, `expires_at` (5 minutes). Burned on use.
- `agent_refresh_token`: `token_hash` (pk), `connection_id` (cascade), `created_at`, `used_at`.
- `access_token.agent_connection` (→ agent_connection, cascade), null for hand-made tokens.

**A connection is live** when `ended_at` is null, `last_used_at` is within 30 days, its person is
enabled, and it was created after the person's `sessions_ended_at` (D5, D10).

**Routes:**
- `GET /.well-known/oauth-protected-resource` and `…/oauth-protected-resource/mcp`:
  `{ resource: origin/mcp, authorization_servers: [origin], scopes_supported: ['mcp'], bearer_methods_supported: ['header'] }`.
- `GET /.well-known/oauth-authorization-server`: issuer `origin`, `authorization_endpoint`
  `origin/featherbase/connect` (the SPA page), `token_endpoint` `origin/api/agent-auth/token`,
  `registration_endpoint` `origin/api/agent-auth/register`, `response_types_supported ['code']`,
  `grant_types_supported ['authorization_code','refresh_token']`,
  `code_challenge_methods_supported ['S256']`, `token_endpoint_auth_methods_supported ['none']`,
  `scopes_supported ['mcp']`.
- `POST /mcp` without a usable token: 401 as today, plus
  `WWW-Authenticate: Bearer resource_metadata="origin/.well-known/oauth-protected-resource/mcp", scope="mcp"`.
- `POST /api/agent-auth/register` (public, rate-limited): RFC 7591. Public clients only
  (`token_endpoint_auth_method` absent or `none`); every redirect URI is `https:` or `http:` on
  127.0.0.1, [::1] or localhost, with no fragment (D6). 201 with `client_id` and the stored fields.
- `GET /api/agent-auth/request?<authorize query>` (signed in): checks `response_type=code`,
  `client_id` known, `redirect_uri` exactly one it registered (loopback: any port, as RFC 8252),
  `code_challenge` present and `code_challenge_method=S256`. Answers the client's name, its
  return place, the person, and `remembered` (D8: a live connection of this person with the same
  client name and return place). A bad client or redirect is an error shown on the page, never a
  redirect.
- `POST /api/agent-auth/decision` (signed in, a person, not a service account): the same query
  plus `allow`. Allow mints a code; Deny returns `error=access_denied`. Either way answers
  `{ redirect }` = redirect_uri with `code`/`error` and the client's `state`.
- `POST /api/agent-auth/token` (public, form-encoded, RFC 6749 errors):
  - `authorization_code`: code, redirect_uri, client_id, code_verifier (S256 check). Creates the
    connection, returns `{ access_token, token_type: 'Bearer', expires_in: 3600, refresh_token, scope: 'mcp' }`.
    The access token is `issueAccessToken(person, client_name, now+1h)` tied to the connection.
  - `refresh_token`: client_id must match. A live connection's unused key returns a fresh pair,
    marks the key used, revokes the connection's earlier access tokens and deletes its expired
    ones, and stamps `last_used_at`. A key used less than two minutes ago renews again (D4 grace).
    A key used earlier ends the connection (`ended_reason` `renewal key reused`) → `invalid_grant`.
- `lookupAccessToken` (auth.ts): a token tied to a connection works only while the connection is
  live, and stamps the connection's `last_used_at`.
- `listAccessTokens` leaves out tokens tied to a connection (D11).
- `GET /api/agent-connections` (own live connections: name, return place, connected, last used),
  `DELETE /api/agent-connections/:id` (own only): ends it and revokes its tokens.
- Vite proxies `/mcp` and `/.well-known` to the API, so dev is one origin as production is.

**Pages** (UI route: verifier against the issue's checklist):
- `/featherbase/connect`: signed out → the usual sign-in, back here (`?next=`). Remembered →
  "Connecting…" and straight back. Otherwise the consent card: the client's name, "will return
  to <return place>", "signed in as <person>", "It will act as you, with your roles and
  permissions, until you disconnect it", Allow and Deny. After the redirect: "You can close this
  window". A bad request: a plain error, no redirect.
- `/featherbase/account/connected-apps`, linked beside Sign-in methods: each live connection with
  connected and last-used times and Disconnect; an empty state saying how to connect.

## 1. Tests

- [x] 1.1 Scenario tests for every `agent-sign-in` scenario, red first, driven by the MCP SDK's
      own OAuth client in-process (an `OAuthClientProvider` whose browser step is a signed-in
      test person calling the request and decision routes)
- [x] 1.2 Server tests for what the scenarios leave out: metadata documents, 401 header,
      registration refusals, authorize refusals, token errors, PKCE mismatch, code reuse,
      grace window, hand-made tokens unchanged and not tied to connections, red first
- [x] 1.3 Web component tests for the connect page and Connected apps, red first

## 2. Server

- [x] 2.1 Migration and the connection model (live rule, last used)
- [x] 2.2 Metadata documents and the `/mcp` 401 header
- [x] 2.3 Registration, request, decision, token routes
- [x] 2.4 Access token lookup and listing honour connections
- [x] 2.5 Connected apps routes

## 3. Web

- [x] 3.1 Connect page, signed-out round trip through sign-in
- [x] 3.2 Connected apps page and its link
- [x] 3.3 Vite proxies for `/mcp` and `/.well-known`

## 4. Proof and release

- [ ] 4.1 Coverage 100% on both suites; typechecks; `pnpm check:scenarios`, `check:specs`
- [x] 4.2 Independent UI verifier against the issue checklist
- [x] 4.3 Real Claude Code against a local instance: sign-in and consent screenshots, a tool call
      returning permitted data and refused forbidden data
- [x] 4.4 Upgrade rehearsed on a restored copy of production
- [x] 4.5 Codex review, findings triaged
- [ ] 4.6 Sync and archive the change; ADR 0027 accepted
