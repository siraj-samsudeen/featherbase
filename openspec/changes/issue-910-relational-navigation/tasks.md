## 1. Before code

- [x] 1.1 Rebase on main after #792 / PR #839; merge #795's branch (PR #857) underneath
- [x] 1.2 Delta specs re-checked against #839's map requirements; independent MECE review applied
- [ ] 1.3 Owner answers the row page's tab set (Form · Map · Tree · Collaboration · Activity
      recommended)

## 2. Shared components and UI Lab (before any page uses them)

- [ ] 2.1 `shop-floor`: DrillPane frame, PathBar, LinkChip (go there, filter), GroupChip (count),
      FieldGrid (two columns, empty fields folded, long text clamped), TreeOutline, PanePlace
      toggle, CompactToggle; unit tests for each
- [ ] 2.2 UI Lab examples for each, searchable; sentence-case section headings
- [ ] 2.3 Shared title: name first, code after (D5), with tests

## 3. Acceptance tests first (fail before the pages)

- [ ] 3.1 Step definitions and page objects for every scenario of `specs/relational-navigation`
      and `specs/list-view`, and the modified search-and-explore scenarios
- [ ] 3.2 Retire the peek, Related tab and map-page steps and page objects

## 4. Navigation state

- [ ] 4.1 Path model: identities only, defensive URL parsing, forward steps dropped on a new
      drill, last 12 steps (unit tests)
- [ ] 4.2 Path bar wiring: back, forward, any step, browser history, copy link, names via row titles
- [ ] 4.3 Per-person settings: compact per table, pane place, last ten paths

## 5. Pages (compose section 2 only)

- [ ] 5.1 Drill pane on lists, row pages and Explore: points at, pointed at by, group rows, open as
      list, drill, fields via #795's arrangement, edit opens the form
- [ ] 5.2 Link cells and form link fields open the pane; filter narrows the list underneath
- [ ] 5.3 Row page: connection chips under the title; Form · Map · Tree in #800's tab set; remove
      Related, peek and the map route
- [ ] 5.4 Map tab: click shows in pane, centre re-centres, labels clear of edges (#794), State by
      name (#907)
- [ ] 5.5 Tree tab and list's tree of all: both directions, several levels, first 20 then all,
      default depth 2
- [ ] 5.6 List: compact toggle

## 6. Check and hand off

- [ ] 6.1 Code review of the permission path (item 22) and URL parsing
- [ ] 6.2 Headless verifier over #910's 22 items, #800's and #795's acceptance points and the UI
      Lab, at 1280 and 900, light and dark; spec-vs-built table with screenshots; fix every gap
- [ ] 6.3 PRs with green CI (#857 refreshed, then #910 on top); sync and archive after owner review
