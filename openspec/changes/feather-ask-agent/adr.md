# ADR Review Manifest

- Status: completed
- Review date: 2026-11-27

## Review Summary

The in-memory tools carry the caller's own credential, which ADR 0021 did not cover; ADR 0028
records it. ADR 0021 still governs everything reaching Featherbase from outside.

## In-Force ADRs Reviewed

- [ADR 0021](../../../adr/0021-agents-reach-featherbase-through-the-http-api-over-mcp.md): `/mcp`
  opens only to an access token. Kept; a session sent to `/mcp` is still refused.
- [ADR 0027](../../../adr/0027-agents-connect-by-signing-in-through-the-instance.md): agent
  sign-in keys. Unchanged; this change makes no tokens, so it adds no clean-up.

## New Durable ADRs Created

- [ADR 0028](../../../adr/0028-an-apps-agent-reads-with-the-callers-own-credential.md): an app's
  agent reads Featherbase with the caller's own credential.
