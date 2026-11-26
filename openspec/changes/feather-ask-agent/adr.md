# ADR Review Manifest

- Status: completed
- Review date: 2026-11-26

## Review Summary

The pass keeps ADR 0021 (only an access token opens the tools); no ADR is superseded. Whether the
pass gets its own ADR is an open question in `design.md`.

## In-Force ADRs Reviewed

- [ADR 0021](../../../adr/0021-agents-reach-featherbase-through-the-http-api-over-mcp.md): agents reach Featherbase through `/mcp` with an access token. Kept:
  the in-memory tools use a real access token (the pass).
- [ADR 0027](../../../adr/0027-agents-connect-by-signing-in-through-the-instance.md): asks for a
  sweep of expired tokens; this change adds one.

## New Durable ADRs Created

- None yet.
