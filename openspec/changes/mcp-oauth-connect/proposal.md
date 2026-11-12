## Why

Connecting an agent to Featherbase today means making an access token by hand, copying it, and
wiring it into the agent's configuration, often through a helper script. Hosted MCP servers ask
for none of that: you paste their address, a browser window opens, you sign in, and it works.
People also end up sharing one service-account token, so the agent acts as that account instead
of as them. This change lets anyone connect any MCP client to their instance by its address alone,
signed in as themselves (#1207).

## What a person sees

1. In Claude, Claude Code, ChatGPT or another MCP client, they add a server with the instance's
   address followed by `/mcp`. Nothing else: no token, no settings.
2. Their browser opens on the instance. If they are not signed in there, they get the usual
   sign-in page with the instance's usual choices (a connected HR sign-in, Google, or email and
   password). If they already are, this step is skipped.
3. A consent page shows which client is asking (the name it gives itself and the address it will
   return to), who they are signed in as, and what it may do: "act as you, with your roles and
   permissions, until you disconnect it". They choose Allow or Deny.
4. The browser says they can close the window. The client is connected and its tools work.

## What a connected client can and cannot do

- It can do exactly what the person can do through Featherbase's tools: see the Tables and rows
  their roles and Data Scope let them see, and add, change and delete rows they could change
  themselves. Every check, automation and refusal applies as when they save in Featherbase.
- History names the person as the actor and marks the change as made through an agent, with the
  client's name.
- It cannot do more than the person. If the person loses a role, the client loses it at its next
  call. It cannot reach the Admin pages or the person's browser session, and it cannot make
  access tokens.
- Service accounts cannot connect this way, because they never sign in. Access tokens made by
  hand keep working for service accounts and automation, unchanged.

## How a connection ends

- **Connected apps**, a page under the person's own account, lists each client they connected:
  its name, when it was connected and when it was last used, with **Disconnect**. Disconnecting
  stops the client at its next call; it would have to ask the person again.
- A connection also ends when the person is disabled, when their password is reset or all their
  sessions are ended, and after 30 days without use.

## How long things last

- The client holds a short-lived key, valid for one hour, and a renewal key it trades for a fresh
  pair whenever the short one runs out. Each renewal key works once.
- While the client is used at least once every 30 days it stays connected, with no new sign-in.

## Security points

- Standard MCP authorization (OAuth 2.1): the instance is its own sign-in server, and every client
  must prove with PKCE that it is the one that started the sign-in.
- Clients register themselves, but a client's name is only what it says it is. So the consent page
  also shows the address it returns to, and a client may return only to a local address on the
  person's own computer or to an `https` address.
- Nothing usable is stored in the clear: keys are kept only as fingerprints, as access tokens are
  today.
- A renewal key used twice is treated as stolen, and the whole connection is ended.
- Web pages on other sites still cannot call `/mcp`.

## What Changes

- `/mcp` without a key answers in the standard way that tells a client where to sign in.
- The instance publishes the standard descriptions of itself as a protected resource and as a
  sign-in server, accepts client self-registration, and runs the sign-in, consent and key
  exchange.
- The short-lived key is an ordinary access token belonging to the person, so `/mcp` and the API
  treat it as they treat one today.
- A Connected apps page under the person's account, with Disconnect.

## Capabilities

### New Capabilities

- `agent-sign-in`: connecting an MCP client by address with a browser sign-in and consent, how
  long the connection lasts, and how it ends.

### Modified Capabilities

- `agent-access`: an agent may also connect through a sign-in, not only with an access token.
