## Why

Writing plain-language specs for external data sources (see `openspec/specs/
external-data-sources/`) against the code turned up several promises from the
old Journey docs (`docs/specs/0001-external-data-sources.md`,
`0002-virtual-doctypes.md`, `0006-connection-console.md`) that are not built
yet. None of them are abandoned — they answer real needs the shipped feature
already implies — but a main spec only describes what exists today. This
change stages them for later work instead of losing them.

## What Changes

- **Notice when a source drifts or a connection dies underneath a connected
  table**, and a guided way to bring the table back in line, instead of the
  connected table failing with a raw error the next time someone opens it.
- **A record of what a connected row's comments, files and other Featherbase
  additions used to point at**, for when the source deletes or renames a row
  they were attached to.
- **A choice of how strict conflict-catching is** on a connected table whose
  source has no last-changed time to check, instead of every save on it
  silently overwriting whatever is there.
- **A guided page for connecting a database by typing a host, user and
  password**, with a step-by-step check of the connection and a plain-English
  reason the moment a step fails — the alternative to today's only path,
  which requires someone to already have an environment variable set on the
  server.
- **Featherbase learning what data a non-database system can supply** — a
  REST API, a queue, a CLI's own state — through some agreed shape, the way
  it already does for a database table.

## Capabilities

### New Capabilities

- `connection-console`: guided, in-app connecting of a database source, with
  a phased connection check and an always-available health view for a
  connection already in use.
- `virtual-data-sources`: a Featherbase table backed by something other than
  a database table, through code an app supplies.

### Modified Capabilities

- `external-data-sources`: adds drift detection and reconciliation, a
  reconcile record for a connected row's Featherbase-side additions, and a
  stricter conflict-catching option for sources with no last-changed time.

## Impact

- No code changes in this proposal; it records scope for future
  implementation work.
- Affected areas when implemented: `apps/server/src/sources/`,
  `apps/server/src/document.ts`, `apps/server/src/controllers/data-source.ts`,
  `apps/web/src/pages/SourceBrowser.tsx` and a new connect-source page
  (today's `apps/web/src/pages/PrototypeConnectSource.tsx` is a throwaway
  mock of the intended design, not a starting implementation).
