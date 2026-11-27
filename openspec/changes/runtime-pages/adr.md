# ADR Review Manifest

- Status: completed
- Review date: 2026-11-27

## Review Summary

ADR review completed for this change. One durable decision is new: the grammar a saved page is written in, and whose code checks and draws it. It is recorded as ADR 0028 with the status Proposed, because the owner was away when it was taken.

## In-Force ADRs Reviewed

Every ADR in `adr/` was read for its status and decision. The ones this change touches:

- ADR 0006 (React, Hono, Postgres): the runtime is React on `main`; the page grammar names no React part, so it does not bind a later stack.
- ADR 0011, 0013, 0014 (platform, apps, instances; one repository): the runtime, the catalog and the `Page` Table are platform; nothing here names an app or a client.
- ADR 0015 (ADRs are never edited): honoured; ADR 0028 is new and supersedes nothing.
- ADR 0017, 0023, 0024 (coverage baselines, ignores at the unreachable spot, core branch coverage reported): honoured by the tests in tasks.md.
- ADR 0021 (agents reach Featherbase through the HTTP API over MCP): honoured. Each new tool is one inner request with the person's own token.
- ADR 0027 (agents connect by signing in through the instance): unchanged.

The others (0005, 0007, 0009, 0010, 0012, 0016, 0018 twice, 0019 twice, 0020, 0022, 0025) concern naming, topology, identity, workflow, coverage history, tokens, accents, retiring rows and data sources, and are not touched.

## New Durable ADRs Created

- `adr/0028-a-runtime-page-is-data-in-a2ui-shape-drawn-by-featherbase.md` (Proposed).

## Superseded ADRs

- None.
