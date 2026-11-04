## Why

Home pages offer Tables and rows that no longer exist, and personal activity still links to them. People need usable destinations without losing their history.

## What Changes

- Continue destinations skip deleted or inaccessible Tables and rows, selecting the next usable destination of the same kind.
- Actual Table renames keep navigation pointing to the same Table under its current name; changed row titles are displayed through authorized reads.
- Actual native row-ID renames carry navigation-only references through the existing rename transaction; reusing an old Table name or native row ID does not revive an earlier destination. External rows use authorized current-ID reads without promising replacement detection or inferred key renames.
- Personal activity retains historical entries, showing deleted Table names struck through without a destination link.
- Preserve event history and the authoritative-history reconciliation contract from #769. Do not infer renames from similar names or send callers destinations they cannot access.
- Resolve legacy events at read time when the named live Table demonstrably predates the event (and a referenced native row belongs to that earlier lifetime; external rows use authorized current-ID reads). An actual locked Table rename may capture separate verified destination metadata for eligible legacy visits so recently opened entries follow the current address; original history fields remain untouched. Unknown identity is unavailable, not an assertion of deletion. No speculative historical backfill.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dashboards-and-home-pages`: Offer the latest usable resume destinations, omitting a kind with no valid candidate.
- `search-and-explore`: Resume only usable destinations while keeping personal history and following actual renames.

## Impact

- Server event recording and destination resolution, personal activity projection, and Table lifecycle identity.
- Home resume and activity rendering; focused server/web regressions and executable acceptance scenarios with disposable local fixtures.
- Plan migration `0016_navigation_destinations.sql`, subject to rechecking the live inventory before implementation: internal Table identity, navigation-only row references, and nullable server-authored destination bindings for new events. Existing event values remain unchanged.
- No staging data access, history deletion or rewrite, deployment, custom-Table rename route, general identity framework, or changes to #865 and #777/#871 rename discovery.

Planning authority: the manager approved the stable internal Table identity and conservative legacy treatment on 03-Nov-2026 under reversible-default authority. This is not a claim of owner design review or permission to implement.
