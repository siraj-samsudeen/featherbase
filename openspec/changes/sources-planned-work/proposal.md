## Why

Writing plain-language specs for external data sources (see `openspec/specs/
external-data-sources/`) against the code turned up several promises from the
old Journey docs (`docs/specs/0001-external-data-sources.md` and
`0006-connection-console.md`) that are not built yet. None of them are
abandoned — they answer real needs the shipped feature already implies — but
a main spec only describes what exists today. This change stages them for
later work instead of losing them.

(`docs/specs/0002-virtual-doctypes.md` — a table backed by an app's own code
instead of any database — was only ever proposed, never ratified by the
owner, so it isn't staged here as planned work. It's filed as GitHub issue
#333 instead.)

## What Changes

- **Notice when a data source drifts or goes unreachable underneath a
  connected table**, and a guided way to bring the table back in line,
  instead of the connected table failing with a raw error the next time
  someone opens it.
- **A record of what a connected row's comments, files and other Featherbase
  additions used to point at**, for when the data source deletes or renames a
  row they were attached to.
- **A choice of how strict conflict-catching is** on a connected table whose
  data source has no last-changed time to check, instead of every save on it
  silently overwriting whatever is there.
- **Showing the user what changed, not just that a save was refused**, when
  a concurrent edit is caught.
- **A guided page for connecting a database by typing a host, user and
  password**, with a step-by-step check and a plain-English reason the
  moment a step fails — the alternative to today's only path, which requires
  someone to already have an environment variable set on the server. It also
  says plainly, on a deployment anyone can sign in to, that a saved data
  source is readable by every System Manager.

Left out on purpose: the old spec's "Advanced" collapsed section for pool
size, timeouts and the allowlist is layout detail, not a promise — it isn't
carried into the delta spec.

## Capabilities

### New Capabilities

- `connection-console`: guided, in-app connecting of a database data source,
  with a phased connection check and an always-available health view for a
  data source already in use.

### Modified Capabilities

- `external-data-sources`: adds drift detection and reconciliation, a
  reconcile record for a connected row's Featherbase-side additions, a
  stricter conflict-catching option for data sources with no last-changed
  time, and showing what changed when a save is refused for that reason.

## Impact

- No code changes in this proposal; it records scope for future
  implementation work.
- Affected areas when implemented: `apps/server/src/sources/`,
  `apps/server/src/document.ts`, `apps/server/src/controllers/data-source.ts`,
  `apps/web/src/pages/SourceBrowser.tsx` and a new connect-source page
  (today's `apps/web/src/pages/PrototypeConnectSource.tsx` is a throwaway
  mock of the intended design, not a starting implementation).
