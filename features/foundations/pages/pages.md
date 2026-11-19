# Pages

The frame every screen sits in, the styles, and the mock-up.

`screens.html` in this folder is the design. Open it in a browser: it is a working mock-up with the rows of
`samples/employees/employees.csv`. It covers Home (fresh install and with data), the entry to importing, the
proposal, and the list with its form. `report.html` is the first report, with charts. Both use `pages.css`, the
one stylesheet of every page. Still to be mocked up: an upload's page.

## Decided

**The web side.** Pages are rendered by the server as HTML, with forms and native controls. htmx updates part of a page without a reload. A small script is allowed for one named interaction HTML cannot do (the file drop zone). React is used only where a screen really requires it, decided and recorded each time. The API (decision 6) is built from the start, not deferred, and an MCP endpoint sits over it as a thin layer, because the owner works with Featherbase through Claude Code. The old `shop-floor` kit is not carried over: the owner judges it unpolished (scrolling bugs in the list, components and layouts that do not fit together)

**The look and layout of the generic screens.** `screens.html` in this folder is the design. It is a working HTML mock-up with made-up rows, chosen by the owner, and the build uses its markup and styles as they are, replacing the sample rows with real data. No separate specification of tokens or components is written: the owner found that premature specification is what spoiled the old kit. The mock-up is improved by editing the HTML itself. It covers the home page (on a fresh install and with data), the entry to importing, and the list with one form for new, edit and delete. It also covers the proposal screen: the Table name, each Column with its type, what Featherbase saw in it and the key, and how the first rows will look. A type is offered only if every cell fits it, and only a Column that is never blank and never repeats can be the key. Still to be mocked up: an upload's page. How a record opens (side panel or full page) and the row height (comfortable or compact) are each person's preference, switchable at any time; both layouts are kept. With no sign-in in this build the preference is remembered in the browser; it becomes a per-person setting when people sign in. Search, sort and filter come later

**Addresses a person sees.** A Table is at `/main/employees`: readable, following its schema and name. A row
is addressed by its `_id` for now.

**One window, one scrolling box.** In the list, only the grid scrolls. The header row and the key Column stay
put, and the page itself never scrolls.

**What the screens took from Claude's Artifacts (19-Nov-2026).** The mock-up was revised after studying the
written guidance behind Claude's HTML Artifacts.

- One stylesheet, `pages.css`, linked by every page, so the screens and the report cannot drift apart. It opens
  with the named values (colours, type sizes, spacing, corner radii), each with a comment on what it is for. That
  is the whole of the "system": there is still no separate token or component document.
- Light and dark are written once: each colour gives both its values with `light-dark()`. The person's system
  setting picks, and `data-theme` on the page overrides it. The dark values are chosen one by one, not inverted.
- Seven type sizes, seven spacing steps and three corner radii, in place of the ten sizes and nine radii the
  mock-up had drifted into. Inter for reading; Space Grotesk only for page titles and big figures; Plex Mono for
  codes and file names.
- A small set of parts: button, box, list, field, chip, tag, Yes/No, the list of rows, the record, a figure, a
  chart. A box is the only thing with a border and rounded corners.
- A Choice's values get colours in one fixed order, and a value keeps its colour everywhere: its chip in the list
  and its bar in a chart. A chip shows the colour as a dot beside the word, so the text stays in the normal ink.
- Real content: the mock-up reads the sample file itself, and the proposal works out "what Featherbase saw" from
  it. Each view has an address (`#home`, `#import`, `#proposal`, `#employees`), as it will on the server.
- Each page is a complete HTML document. The old mock-up relied on the Artifact viewer to hide the views not
  shown; opened as a plain file, it showed every view at once.

**Reports and charts.** A chart is SVG drawn by the server: no chart library and no script. Hovering a mark shows
its value (an SVG title), and each chart keeps its numbers in a table under "Show the numbers". A chart has a plain
title and one sentence that says what it shows. Big figures sit in a row above the charts. One axis per chart; a
single measure uses the accent colour; a Choice uses its series colours. The first report is "Employees overview",
`report.html`.

