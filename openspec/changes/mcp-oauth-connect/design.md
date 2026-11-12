## Context

`/mcp` (ADR 0021) accepts only a hand-made access token, and each tool call is an in-process
`/api` request carrying it. The MCP specification's authorization section (OAuth 2.1 with
protected-resource metadata, authorization-server metadata, dynamic client registration and
PKCE) is what Claude, Claude Code, ChatGPT and other clients follow to sign in from a URL alone.
The decisions below are those where a good engineer could pick otherwise. Each one was answered
by the agent, favouring ease of use and long-term maintainability, for the owner's review.

```mermaid
flowchart LR
  person([Person]) -- pastes /mcp --> client[MCP client]
  client -- 1. POST /mcp, no key --> mcp[/mcp]
  mcp -- 401 + where to sign in --> client
  client -- 2. reads metadata, registers --> as[Instance's sign-in server]
  client -- 3. opens browser --> as
  as -- signed out --> login[Usual sign-in page]
  login -- back --> as
  as -- 4. consent, Allow --> client
  client -- 5. code + PKCE verifier --> as
  as -- short key + renewal key --> client
  client -- 6. POST /mcp, Bearer short key --> mcp
  mcp -- in-process /api as the person --> api[(HTTP API)]
```

## Decisions

### D1. Who runs the sign-in server

Question: should the instance be its own OAuth authorization server, or delegate to an outside
one (Google, an identity product)?
Choice: the instance itself, at its own address.
Why: people sign in with the instance's own methods (HR sign-in, Google, password), and only the
instance knows them and the person's roles. An outside server would add a second account system
to keep in step. Rejected: an outside identity product, which costs a dependency and a
configuration per instance.

### D2. What the short-lived key is

Question: a signed, self-contained token (JWT) or an ordinary access token row?
Choice: an ordinary person-owned access token, with a one-hour expiry, linked to its connection.
Why: `/mcp` and every `/api` route already accept it, and checking it already looks the token up,
so disconnecting or disabling the person takes effect at the very next call. Nothing new has to
be trusted. Rejected: JWT, which cannot be revoked before expiry without a lookup anyway and
would be a second credential format.

### D3. One access token row per renewal

Question: refresh by extending one access token, or mint a new one each hour?
Choice: each renewal mints a new access token and revokes the previous one; both belong to the
same connection. Old rows of a connection are deleted once they expire.
Why: a leaked short key dies within the hour whatever happens; deleting expired rows keeps the
table small. Rejected: one long-lived row with a sliding expiry, which makes the short key a long
key in practice.

### D4. Renewal keys rotate, and reuse ends the connection

Question: may a renewal key be used more than once?
Choice: once. Using a spent renewal key ends the whole connection.
Why: OAuth 2.1 requires rotation or sender binding for public clients; rotation with reuse
detection is the simple one, and a reuse means two parties hold the key. Rejected: reusable
renewal keys, which a thief could use forever.

### D5. How long a connection lasts

Question: what lifetimes?
Choice: short key 1 hour; a connection ends after 30 days without use; no absolute limit while
used.
Why: ease of use first, the MotherDuck experience being "connect once". An unused connection
retires itself. Rejected: tying it to the instance's session length (8 hours by default), which
would make people sign in again daily.

### D6. Which clients may register

Question: open self-registration, an admin-approved list, or the newer client-ID-metadata
documents?
Choice: open self-registration, public clients only (no client secret), with redirect addresses
limited to loopback `http` (127.0.0.1, ::1 or localhost on any port) and `https`.
Why: every listed client supports dynamic registration today, and an admin step defeats "paste
the URL". Registering grants nothing; only a person's Allow does. Rejected: an allowlist (an admin
step); client-ID metadata documents (not yet supported by all clients, can be added later).

### D7. What the consent page promises

Question: offer narrower scopes (read-only, some Tables) or one?
Choice: one scope, "act as you". The consent page shows the client's name, its return address,
the signed-in person, and that sentence.
Why: the person's roles already decide what is reachable, and every agent client already asks
before destructive tools. A read-only scope is the obvious next step and can be added without
changing anything here. Rejected now: per-Table scopes, which duplicate permissions.

### D8. Consent every time

Question: remember a person's Allow for a client and skip the page next time?
Choice: always ask. Each Allow creates its own connection.
Why: clients re-register freely, so "the same client" cannot be told apart reliably, and a silent
grant is the classic way an attacker obtains a key. One click is cheap. Rejected: remembered
consent.

### D9. How the sign-in step reuses Featherbase's sign-in

Question: build a sign-in form into the authorize page, or send the browser through the normal
sign-in?
Choice: the authorize page checks the browser's normal session; when there is none it sends the
browser to the usual sign-in page with a return to the authorize page, which the sign-in page
already supports for same-site paths.
Why: every sign-in method, and every rule about them, works unchanged. Rejected: a separate form,
which would have to repeat each method.

### D10. When a connection ends besides Disconnect

Question: should password resets and "end all sessions" end connections too?
Choice: yes. A connection made before the person's sessions were last ended stops working, as do
connections of a disabled person.
Why: a person who suspects their account was taken over resets the password and expects that to
lock everyone else out. Hand-made access tokens keep their current rule (revoked separately),
because they are deliberate, named credentials.

### D11. Where Connected apps lives

Question: under Admin, or the person's own account pages?
Choice: the person's own account pages, beside Sign-in methods. The connection's tokens do not
appear in the Admin access token list.
Why: every person can connect, and most people have no Admin. A connection rotates its token
hourly, so listing its tokens would bury the hand-made ones. Disabling a person ends all their
connections, which covers a leaver. Rejected: an Admin list of everyone's connections, which can
come when someone needs it.

### D12. Several addresses of one instance

Question: an instance may answer on several addresses; which one is the issuer?
Choice: the address the client used. The metadata, the authorize page and the token endpoint
are all on that address, and the browser session it checks is that address's own.
Why: a sign-in finishes where it began, as hand-off already insists (#488). The resulting key
works on any address, as access tokens do today.
