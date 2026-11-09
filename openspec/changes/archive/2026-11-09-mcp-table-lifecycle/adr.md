# ADR Review Manifest

- Status: completed
- Review date: 2026-11-09

## Review Summary

ADR review completed for this change. No major durable architectural decision is introduced and no
new repository-level ADR file was created: the new tools follow ADR 0021 (agents reach Featherbase
through the existing HTTP API, over MCP, with an access token). Parsing a CSV on the server for
`/mcp` (design D3) and the check digest (D4) are choices of this tool layer, not commitments other
changes build on.

## In-Force ADRs Reviewed

- ADR 0021 (agents through the HTTP API over MCP): every new tool is an in-process request to an
  existing route with the caller's token; no new route.
- ADR 0006 (React, Hono, Postgres) and ADR 0011 / 0014 (platform, apps, instances): platform code
  only; the shared import functions stay in `packages/shared`.
- ADR 0009 (record identity): rows matched by a key column or by `row_id`, as the import does.
- ADR 0012, 0016, 0017 (coverage): the server's coverage caps apply to the new module.
- ADR 0015 (ADRs are never edited): no prior ADR is changed.
- Others (0005, 0007, 0010, 0013, 0018 x2, 0019 x2, 0020) checked; none bears on this change.

## New Durable ADRs Created

- None.
