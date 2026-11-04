## 1. Before code

- [ ] 1.1 Rebase on main once #792 / PR #839 has merged; re-check the delta specs against its
      archived search-and-explore and list-view changes (the map's row lists by title)
- [ ] 1.2 Owner approves the design decisions and the row page's tab set

## 2. Acceptance tests first (fail before the build)

- [ ] 2.1 Step definitions and page objects for the drill pane, path bar and row-page tabs; every
      scenario of `specs/relational-navigation` fails for the right reason
- [ ] 2.2 Scenarios for the compact list and the tree of all rows (`specs/list-view`)
- [ ] 2.3 Retire the peek, Related tab and map-page steps and page objects with the removed
      requirements

## 3. Navigation state

- [ ] 3.1 Path model: steps as identities, parse a URL defensively, truncate forward steps on a new
      drill, keep the last 12 (unit tests)
- [ ] 3.2 Path bar: back, forward, any step, browser history, copy link; names through the row-title
      lookup
- [ ] 3.3 Per-person settings: compact per table, pane place, last ten paths

## 4. Drill pane

- [ ] 4.1 Pane on list and row pages, placed for the window size, with the person's override
- [ ] 4.2 Points at: names, go there, filter the list underneath; unreadable links unnamed
- [ ] 4.3 Pointed at by: counted groups, rows as a table or compact, open as list, drill on click
- [ ] 4.4 Fields: sections, two-column grid, formatted values, empty fields folded, long text
      clamped, edit opens the form
- [ ] 4.5 Link cells in lists and link fields on forms open the pane; Explore's last pane uses it

## 5. Row page and list

- [ ] 5.1 Connection chips under the title; remove the Related tab and peek
- [ ] 5.2 Form · Map · Tree tabs that keep the centre row and expansion; map moved in from its page,
      click shows in the pane, focus re-centres, labels clear of edges; remove the map route
- [ ] 5.3 Tree: links above, groups below, several levels, first 20 then all, default depth 2
- [ ] 5.4 List: compact toggle, tree of all rows

## 6. Check and hand off

- [ ] 6.1 Code review of the permission path (item 22) and the URL parsing
- [ ] 6.2 Headless verifier against the issue's 22 items at 1280 and 900, light and dark: spec vs
      built table with screenshots; fix every gap
- [ ] 6.3 PR with green CI; sync and archive the change once the owner has reviewed
