## Why

People check master data by walking between related rows: a site, its plants, a plant's profit
centres, their cost centres, and back up to the region. Today that walk crosses four separate
surfaces (the Related tab, the peek slide-over, the relationship map page and its row lists).
None of them keeps the path, and none shows what a row points at and what points at it side by
side, so people lose their place and re-open lists by hand (#909).

Agreed with the owner on 04-Nov-2026 from a clickable prototype on Jeyarama's organisation
masters (Site → Plant → Profit centre → Cost centre); see `reference/`. Issue #910's numbered
checklist is the UI contract.

## What Changes

- **Drill pane.** Selecting a row in any list opens one pane beside or below the list: the row's
  name, what it points at (each with go-there and filter actions), what points at it as counted
  groups, and its fields read-only. Clicking a row inside the pane drills into it.
- **Path bar.** Every drill and every filter becomes a named step. Back and forward, the browser's
  own buttons, a shareable link for each step, and the last ten paths per person.
- **Row page: Form · Map · Tree.** The relationship map becomes a tab of the row page, beside a
  new expandable tree of links in both directions. The same counted groups sit under the row's
  title.
- **List: Compact and Tree of all.** A list can show a compact name-first layout, remembered per
  table, and every row of a table as a collapsed tree.
- **BREAKING (pre-release):** the peek slide-over, the row page's Related tab and the separate
  relationship-map page are removed; the drill pane and the row page's tabs replace them. No
  redirects.
- Closes #907 (the map names the linked State) and #909 items 1–5, 7 and 9.

## Capabilities

### New Capabilities

- `relational-navigation`: the drill pane, the path bar, recent paths, and the row page's Map and
  Tree, in the order a person meets them walking from a list to a row and back.

### Modified Capabilities

- `list-view`: a compact layout remembered per table, and a tree of all rows.
- `core-forms`: following a link opens the drill pane instead of the peek slide-over.
- `search-and-explore`: the relationship map moves into the row page; its trail is replaced by the
  path bar.

## Impact

Web only for behaviour: the list view, the row page, a new pane, path and tree components, and
removal of the peek panel, the Related tab and the map route. Data comes from the existing
permission-scoped reads (row, list, connections, row titles); the per-person choices are kept in
the existing per-person settings. Acceptance tests and page objects for peek, Related and the map
move to the new surfaces. Builds on #792 / PR #839 (rows read by their name).
