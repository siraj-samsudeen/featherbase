# ADR Review Manifest

- Status: completed
- Review date: 2026-11-08

## Review Summary

ADR review completed for this change. One durable decision is recorded: agents reach Featherbase
through the existing HTTP API, over MCP, authenticated only by an access token (design D2, D3, D4).
The owner approved the design on 09-Nov-2026, so it is Accepted.

## In-Force ADRs Reviewed

- ADR 0006 (React, Hono, Postgres): `/mcp` is a Hono route in the same server.
- ADR 0007 (app and database topology) and ADR 0011 / 0014 (platform, apps, instances): `/mcp` is
  platform code and serves every instance's Tables; it imports nothing from apps.
- ADR 0009 (record identity, id and name): tools address a row by its id, `row_id`.
- ADR 0019 (retiring a row is a platform standard): queries leave retired rows out unless asked.
- ADR 0015 (ADRs are never edited): no prior ADR is changed.
- Others (0005, 0010, 0012, 0013, 0016, 0017, 0018 x2, 0019 accents, 0020) checked; none bears
  on this change.

## New Durable ADRs Created

- [ADR 0021: Agents reach Featherbase through the HTTP API, over MCP, with an access token](../../../adr/0021-agents-reach-featherbase-through-the-http-api-over-mcp.md)
