# Pages

The frame every screen sits in, the styles, and the mock-up.

`screens.html` in this folder is the design. Open it in a browser: it is a working mock-up with made-up rows.
It covers Home (fresh install and with data), the entry to importing, the proposal, and the list with its
form. Still to be mocked up: an upload's page.

## Decided

**The web side.** Pages are rendered by the server as HTML, with forms and native controls. htmx updates part of a page without a reload. A small script is allowed for one named interaction HTML cannot do (the file drop zone). React is used only where a screen really requires it, decided and recorded each time. The API (decision 6) is built from the start, not deferred, and an MCP endpoint sits over it as a thin layer, because the owner works with Featherbase through Claude Code. The old `shop-floor` kit is not carried over: the owner judges it unpolished (scrolling bugs in the list, components and layouts that do not fit together)

**The look and layout of the generic screens.** `design/screens.html` is the design. It is a working HTML mock-up with made-up rows, chosen by the owner, and the build uses its markup and styles as they are, replacing the sample rows with real data. No separate specification of tokens or components is written: the owner found that premature specification is what spoiled the old kit. The mock-up is improved by editing the HTML itself. It covers the home page (on a fresh install and with data), the entry to importing, and the list with one form for new, edit and delete. It also covers the proposal screen: the Table name, each Column with its type, what Featherbase saw in it and the key, and how the first rows will look. A type is offered only if every cell fits it, and only a Column that is never blank and never repeats can be the key. Still to be mocked up: an upload's page. How a record opens (side panel or full page) and the row height (comfortable or compact) are each person's preference, switchable at any time; both layouts are kept. With no sign-in in this build the preference is remembered in the browser; it becomes a per-person setting when people sign in. Search, sort and filter come later

**Addresses a person sees.** A Table is at `/main/employees`: readable, following its schema and name. A row
is addressed by its `_id` for now.

**One window, one scrolling box.** In the list, only the grid scrolls. The header row and the key Column stay
put, and the page itself never scrolls.
