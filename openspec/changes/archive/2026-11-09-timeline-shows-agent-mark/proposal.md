## Why

A change an agent makes through `/mcp` is recorded with the access token it used, but the row's
Activity and the Version record never showed it: a person reading the history saw "Siraj edited",
the same as a change Siraj made by hand, and a row an agent created read "created" twice (#1101).

## What Changes

- An entry made through an agent reads "<person> edited via <token label> · <time>", and a row an
  agent created opens with "<person> created this via <token label>". "via <token label>" is a
  small subdued chip after the verb. The actor stays the person (or the service account).
- The agent's "created" entry is folded into the "created this" line, so a row an agent created
  says "created" once.
- A Version record made through an agent reads "Changed by <person> via <token label>".
- Entries made by hand look as before.

## Capabilities

### Modified Capabilities

- `agent-access`: the history says, in words a person reads, which changes were made through an
  agent and with which token.

## Impact

- `apps/web` only: `ActivityTimeline.tsx`, `ChangeRecord.tsx` and the types they read. The server
  already returns the mark (`data.agent.token_label` from `/api/activity`). No schema, route or API
  change.
