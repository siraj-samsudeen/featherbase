## Why

An agent connected at `/mcp` could change a row without saying which version of it it had read:
`update_row` then read the row's current version itself and sent that, so the agent overwrote a
change someone made after the agent last looked, and nobody was told (#1101, found after #1083).

## What Changes

- `update_row` requires the `updated_at` the agent last read (from `get_row` or `query_rows`).
  Without it the tool refuses and tells the agent to read the row first; with a stale one the API
  refuses with its own conflict error, as before.
- `delete_row` requires it too and passes it to the API's delete, which compares it where it keeps
  a version check (an app's rows and a connected database's rows).
- `query_rows` returns each row's `updated_at` when the agent names no columns, so a row found by a
  query can be changed without opening it first.

## Capabilities

### Modified Capabilities

- `agent-access`: a change through an agent never overwrites a change the agent has not seen.

## Impact

- `apps/server/src/mcp.ts` only: tool inputs, descriptions and the default columns of
  `query_rows`. No schema, route or API change.
