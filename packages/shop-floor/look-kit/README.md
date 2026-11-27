# Featherbase look kit

Draw an HTML prototype that already looks like Featherbase, so the screen agreed with users and the screen
built in Featherbase are the same picture. Plain files, no build step: they work opened from disk.

| File | What it is |
|---|---|
| `featherbase-look.css` | The one stylesheet: Featherbase's colours, light and dark, its font, its icons, and one class per control. |
| `featherbase-look.js` | Optional. Reads the page's data, writes amounts and dates the Featherbase way, and makes the toggle, the tabs and the opening row work. |
| `index.html` | The gallery: every control drawn, with the markup to copy under it. Open it first. |
| `starter.html` | A whole screen made with the kit. Copy it to start. |

## Start a prototype

1. Copy `starter.html` and give it your screen's name. Keep it in one folder with `featherbase-look.css` and
   `featherbase-look.js` (copy those two beside it if the prototype lives elsewhere).
2. Open `index.html` in a browser. Find each control your screen needs and copy its markup. The classes all
   start with `fb-`.
3. Put your made-up rows in the data slot (below) and draw the screen from them.
4. Look at it light and dark: add `?theme=dark` to the address.

The smallest page:

```html
<!doctype html>
<html lang="en" data-theme="light">
<head>
  <meta charset="utf-8">
  <title>Review The Month</title>
  <link rel="stylesheet" href="featherbase-look.css">
</head>
<body>
  <div class="fb-shell">
    <aside class="fb-shell-placeholder" aria-label="Featherbase shell">
      <strong>Featherbase shell</strong>
      <span>The platform draws the sidebar here.</span>
    </aside>
    <main class="fb-page">
      <header class="fb-page-header">
        <div class="fb-page-header-row">
          <div class="fb-page-header-lead"><h1 class="fb-title">Review The Month</h1></div>
        </div>
      </header>
      <!-- your screen -->
    </main>
  </div>
  <script type="application/json" id="fb-data">{ "rows": [] }</script>
  <script src="featherbase-look.js"></script>
</body>
</html>
```

## House rules

1. **The shell is the platform's.** Never draw a sidebar or a top bar. Show the one placeholder block labelled
   "Featherbase shell" and put your screen in `fb-page`.
2. **Fills and shadows, not lines.** The page is one white panel on a grey canvas. A group inside it is a quiet
   grey block (`fb-card`). Rows are told apart by space and the tint under the pointer. Do not add borders,
   rules or boxes.
3. **Content fills the space after the sidebar.** No `max-width` on the page or on a table.
4. **Headings are in Title Case**: page titles, card titles, column headers, button labels.
5. **Every record shown is a link.** A person, a store, a section, a department, a ticket: each is an
   `fb-record-link` that opens it, named with `data-table` and `data-row`. Plain text
   (`fb-record-link--text`) only where the viewer may not open it.
6. **A person always shows code, role and place**: "Arun Prakash · TN-10001 · Store Manager · Lakeside". Use
   the Person Label markup, never a bare name.
7. **Amounts have the rupee sign and Indian digit grouping**: ₹12,34,567. A summary figure may read ₹2.48 L or
   ₹1.74 Cr. Use `fbLook.inr()` for those, `fbLook.exact()` for an amount that is paid or must add up, and
   `fbLook.count()` for pieces.
8. **Dates are DD-Mon-YYYY**: 01-Dec-2026. Keep them as `2026-12-01` in the data and write them with
   `fbLook.date()`.
9. **Colour has a meaning.** Red is below target or an error, amber is near, green is met, and blue is the one
   action colour. A chart's parts take the series colours, which mean nothing. Never colour for decoration.
10. **Desktop first.** Draw for a 1280 px wide window. Add a phone layout only when asked.
11. **Made-up names and figures only** in anything that goes into a public repository.

## Keep the data in one slot

Every name and figure the screen shows comes from one block of JSON in the page. Nothing is typed into the
markup. The same file can then be fed real rows later by filling that block, with no other change.

```html
<script type="application/json" id="fb-data">
{
  "month": "2026-12-01",
  "sections": [
    { "section_id": "S01", "section": "Sarees", "forecast": 420000, "last_month": 385000 }
  ]
}
</script>
<script src="featherbase-look.js"></script>
<script>
  const data = fbLook.data()          // the slot, parsed
  function render() { /* build the markup from data, with fbLook.inr(), fbLook.date() and fbLook.escape() */ }
  render()
</script>
```

- **One list per dataset, flat rows, plain column names** (`section_id`, `forecast`), as a table in the
  warehouse would hold them. Not a tree shaped like the screen.
- **Raw values**: numbers as numbers (`420000`, not `"₹4.20 L"`), days as `YYYY-MM-DD`. The page formats them.
- **One `render()` function** draws the screen from the data and from the state of the toggles. A toggle
  changes the state and calls `render()` again.
- A choice the person makes on the page (an accepted figure, a note) is kept in a variable beside the data,
  never written back into it.

## What not to do

- **No colours of your own.** No hex, `rgb()` or named colour anywhere. Every colour is a token, such as
  `var(--color-ink-muted)`; the list is at the top of `featherbase-look.css`.
- **No sidebar, top bar or app chrome of your own.**
- **No new control styles.** No restyled button, pill, tab, input or table. If the gallery has the control,
  use its markup unchanged.
- **No other font, no icon library, no CSS or JavaScript framework, nothing loaded from the web.**
- **No new radius or shadow.** Use `var(--radius-card)`, `var(--radius-control)` and the `--shadow-*` tokens.
- Your own CSS is for **layout only**: grid, flex, gap, width, and spacing between the kit's controls.

## When the kit does not have what you need

Do not invent a look. Build it from the nearest controls, mark it on the page with
`<span class="fb-tag">not in the kit</span>`, and list it at the end of your hand-over. It is then decided once,
as a shared component, instead of differently in each prototype. Three such patterns are already in the kit
and labelled "not yet a shared component": a table with grouped column bands, a row that opens in place, and
the "built from" share bar and donut.

## For whoever changes the kit

`featherbase-look.css` is built by `tools/look-kit.mjs`; do not edit it. Its tokens are copied from
`packages/shop-floor/src/styles.css`, its icons from the components' icon set, its classes from
`src/classes.css`, and the font from the package the app serves. Each class restates one shared component in
`packages/shop-floor/src`; when a component's look changes, change its class to match.

```bash
pnpm look-kit         # rebuild featherbase-look.css
pnpm check:look-kit   # fails when the committed file is stale, naming each token that differs
```
