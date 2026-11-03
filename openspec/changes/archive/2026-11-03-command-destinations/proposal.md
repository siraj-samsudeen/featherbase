## Why

People should find the pages and Tables they can use without being given a URL. Cmd K currently omits standalone pages and app destinations, truncates the manager's Table inventory and does not dismiss on Escape from a focused result.

## What Changes

- Add searchable, permission-filtered independently openable destinations from existing page, Table, Home Page and app sources, including singleton settings and declared app tabs.
- Distinguish pages, Tables, settings and app destinations without duplicating destinations or changing record search and commands.
- Preserve the query when dismissing results by outside pointer or Escape anywhere in the command bar; focus or Cmd K reopens them.
- Guard every router family with an explicit discovery source or contextual/entry-flow exclusion.
- Leave sidebar design, health remedies, app-internal state and canonical routing to their existing owners.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `admin-ui-feedback`: complete permitted destination discovery and query-preserving dismissal.

## Impact

Shared page classification, a server-filtered navigation inventory, the Admin command bar and public HTTP/browser tests. No schema migration or permission expansion. Based on origin/main 422babb8; #821 canonical routing remains unmerged and must be integrated separately.
