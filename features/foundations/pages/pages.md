# Pages

The frame every screen sits in, the styles, and the mock-up.

`screens.html` in this folder is the design. Open it in a browser: it is a working mock-up filled with the
sample employee rows. It covers Home (fresh install and with data), the entry to importing, the proposal, and
the list with its form. `report.html` is the design for a report with charts. Both use `pages.css`, the one
stylesheet. Still to be mocked up: an upload's page.

## Decided

**The web side.** Pages are rendered by the server as HTML, with forms and native controls. htmx updates part of a page without a reload. A small script is allowed for one named interaction HTML cannot do (the file drop zone). React is used only where a screen really requires it, decided and recorded each time. The API (decision 6) is built from the start, not deferred, and an MCP endpoint sits over it as a thin layer, because the owner works with Featherbase through Claude Code. The old `shop-floor` kit is not carried over: the owner judges it unpolished (scrolling bugs in the list, components and layouts that do not fit together)

**The look and layout of the generic screens.** `screens.html` in this folder is the design. It is a working HTML mock-up with made-up rows, chosen by the owner, and the build uses its markup and styles as they are, replacing the sample rows with real data. No separate specification of tokens or components is written: the owner found that premature specification is what spoiled the old kit. The mock-up is improved by editing the HTML itself. It covers the home page (on a fresh install and with data), the entry to importing, and the list with one form for new, edit and delete. It also covers the proposal screen: the Table name, each Column with its type, what Featherbase saw in it and the key, and how the first rows will look. A type is offered only if every cell fits it, and only a Column that is never blank and never repeats can be the key. Still to be mocked up: an upload's page. How a record opens (side panel or full page) and the row height (comfortable or compact) are each person's preference, switchable at any time; both layouts are kept. With no sign-in in this build the preference is remembered in the browser; it becomes a per-person setting when people sign in. Search, sort and filter come later

**Addresses a person sees.** A Table is at `/main/employees`: readable, following its schema and name. A row
is addressed by its `_id` for now.

**One window, one scrolling box.** In the list, only the grid scrolls. The header row and the key Column stay
put, and the page itself never scrolls.

**One look for all of Featherbase (19-Nov-2026).** The look is the one the owner agreed for the live app:
`docs/design/look-and-relationships-spec.md` on `main`, Part 1, with its boards in
`docs/design/mockups/look-and-relationships.html`. Fills and space instead of lines; a grey canvas with the
sidebar on it and one white panel; grey-filled buttons and inputs with one blue primary button; blue only for
what opens something; 44 px rows with Compact Rows at 32; a 20 px page title in Title Case; eight chip tints,
status chips, and red only for a problem with the data. The React screens of the live app and the HTML screens
of the rebuild are to look the same.

- The named values at the top of `pages.css` are the one place the look's colours and sizes are written. The
  live app should point its theme at the same names, so a change is made once.
- Both are checked by screenshot against the same boards.
- The boards are light only. The dark values in `pages.css` are this mock-up's own and are still to be agreed.
- The boards give a value its tint from its name; this mock-up gives tints out in the order of the list of
  values. One rule has to be chosen for both.
- This mock-up adds screens the boards do not have: Home, the entry to importing, the proposal, the form with
  a refusal, and a report.

**How the mock-up is made, from a study of Claude's Artifacts (19-Nov-2026).**

- One stylesheet, `pages.css`, used by every page and by the build as it is. It opens with the named values:
  colours named by their job, six type sizes, six steps of space, three corner radii. Rules below use the names
  and never a raw value. This block in the stylesheet is the only place they are written down.
- Each colour holds its light and dark value side by side with `light-dark()`, so the two cannot drift. The
  device's setting picks; `data-theme` on the page overrides it.
- The mock-up is plain HTML. Every row, form and message is written out in the file, the way the server will
  send it, and nothing is built by script. Each screen and each state has an address: `#fresh`, `#home`,
  `#import`, `#proposal`, `#employees`, `#record`, `#new`, `#refused`. The one script is marked mock-up only; it
  stands in for the server.
- The rows are the 24 in `samples/employees/employees.csv`. When that file changes, the mock-up is refilled
  from it.
- Controls are the browser's own. The delete question is a popover, the View menu is a `<details>`, and the
  row-height switch is a pair of radio buttons; none needs script. A refusal is shown under the field it is
  about.
- Row height is switched beside the list, as on the boards. How a record opens is in the **View** menu.
- A record's name is the link that opens it; its code is not blue.
- Home with data also says, for each Table, how many Columns it has and its key, and lists reports.

**Reports and charts.** `report.html` is the design. A report is a page like any other: one row of filters
above everything it changes, then headline numbers in quiet blocks, then charts on the white panel. Charts are
drawn by the server, bars as plain boxes and a line as SVG, with no chart library and no script. A number is
used where a chart would have one bar. Each chart has a title, one sentence saying what it shows, a label on
the points that matter, and its numbers in a table under "Show as a table". One axis per chart. A Choice value
keeps one colour everywhere: a department's bar wears its chip's colour at full strength, and the bar is always
named as well, so colour is never the only clue. A total is drawn in a neutral grey, and text never takes a
chart colour. The rows behind a headline number can follow the charts as an ordinary table, as "Who Left" does.
The first report is Headcount, worked out from the sample rows.
