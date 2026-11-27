# Runtime pages: design

The design behind issue #1410. Written 27-Nov-2026 with the owner, one decision at a time. Every
example uses made-up data (a shop that plans next month's reorder).

**Status of each decision** is written beside it: *agreed (owner, date)*, or *taken by default*
where the owner was away and had said to take the recommendation after five minutes. The first
slice (section 9) is built under issue #1410; nothing else here is built.

## 1. What the owner asked for

In a meeting with users, through the Featherbase MCP:

1. "Create an app": a shell with its sidebar appears.
2. "Import this data": Tables with their list views.
3. "Create a UI for this": a custom screen is saved through the MCP and drawn by a runtime inside
   the Featherbase shell. Nothing is deployed.
4. When the screen is agreed: "save it as a runtime app", or "convert it to code" so it is in Git.

Frappe has the first and last steps for its standard screens. The new part is the custom screen,
because an agent can now write one in minutes.

**Why.** Two pains recur in app builds:

- An agent draws a faithful prototype, then loses layout and detail when the real screen is built
  from it. The screen that was agreed is not the screen that ships.
- Every build waits on CI, a merge and a deploy, and often on data that is not in the warehouse
  yet. Users cannot react to a real screen early. The fastest loop seen so far was a page fed by a
  data file, with no deploy in the loop: users gave feedback within 20 minutes.

A runtime page removes both: the screen agreed in the meeting is the screen that stays, and it is
on a shared address the moment it is saved.

**Already decided by the owner before this design:**

- Early users of runtime pages are trusted people. Hardening comes in phases.
- No AI inside Featherbase. The agent stays outside and works through the MCP.
- The Forecasting Team Leader screen is built first on the prototype route, by other work. This
  design does not touch it.

## 2. What exists today

Read on `main` at `06413c651` and on the redesign at `origin/first-build-welcome-page`.

### On `main`

| Meeting step | Exists | Missing |
|---|---|---|
| Create an app | An app is a folder in Git: `featherbase.json`, server code, a built screen bundle (`apps/server/src/runtime-packages.ts`). A System Manager installs it from Admin → Apps. An older path installs an app from a JSON manifest with no code: Tables, roles, grants and starting rows only (`installAppFromManifest` in `apps/server/src/apps.ts`). | No MCP tool knows about apps. An app made from a JSON manifest has no pages and no sidebar of its own: only an app with a built bundle has those. |
| Import this data | `suggest_table`, `create_table`, `check_import`, `run_import`, `undo_import` (`apps/server/src/mcp-table-tools.ts`). The new Table gets the generic list and form at once. | The Table cannot be placed under an app from the MCP. A declared dataset (a warehouse query, `apps/server/src/app-datasets.ts`) can only be declared in an app's code, and there is no sample-data stand-in. |
| Create a UI | Two kinds of page are saved as rows and drawn by Featherbase: Dashboards (number cards and charts) and Home pages (grouped links). Dash shows a MotherDuck Dive in a frame: a runtime page that lives in MotherDuck and cannot read a Featherbase Table. | Everything else. A custom screen is React code, built by Vite and shipped by a deploy. |
| Save as a runtime app, or convert to code | A promise in `docs/VISION.md`: "promotion never moves data". | No code does it, for Tables or for screens. |

Three things on `main` that this design leans on:

- **The MCP is a thin layer.** Each tool is one inner call to the HTTP API with the person's own
  access token (`apps/server/src/mcp.ts`, ADR 0021). Permissions, Data Scope, sensitive columns,
  the trigger chain and the audit trail apply unchanged.
- **A page saved as a row is not new.** Dashboards and Home pages already work that way.
- **View as** (#1222) already lets a tester see an app as another person, read-only.

### On the redesign

The redesign (`BIG-PICTURE.md`, `APPS-AND-SHARING.md`) has its first builds only: a welcome page
and importing a spreadsheet. It has no sign-in, no permissions, no apps and no MCP yet. Two of its
decisions shape this design:

- Pages are HTML from the server, with htmx. React is used only where a screen needs it.
- The `shop-floor` component kit is not carried over. The redesign has its own parts
  (`parts.ts` in the spike, PR 1393).

## 3. Decision 1: which Featherbase

**Agreed (owner, 27-Nov-2026): build on `main` now, redesign-ready.**

The runtime is built on today's `main`, where the apps, the people, the roles, the MCP, View as
and datasets already are. A saved page is plain data that names no React and no `shop-floor`
part, so the redesign can later draw the same saved page with its own HTML parts.

```
  SAVED PAGE (plain data, in Postgres)
  +----------------------------------+
  | title, layout, parts by NAME     |
  | ("table", "toggle", "button")    |
  | data it reads, actions it fires  |
  +----------------+-----------------+
                   |
        +----------+-----------+
        |                      |
  main (build now)       redesign (later)
  React draws it with    server HTML draws
  shop-floor parts       it with its parts
```

What this costs, accepted with the decision:

- Part names stay neutral, so a page cannot use a trick only React can do.
- The parts are drawn twice in the end, once per Featherbase.

Rejected: **`main` only** (every saved page would be rewritten by hand when production moves, and
new work would be tied to a kit the owner judges unpolished); **the redesign only** (no help in
meetings until the redesign has people, roles, apps and the MCP).

## 4. The worked example

One made-up screen is used through the rest of this document. It has the shape of the screens
that drifted: a table with grouped column bands, a toggle, a row that opens in place, and one
"accept or change" save.

```
  Reorder plan, December                         [ Value | Quantity* ]
  (Sample data, loaded 27-Nov-2026)

               |   Last month     |     Next month          |
  Category     |  Sold | Returned | Suggested | Planned     |
  -------------+-------+----------+-----------+-------------+
  v Stationery | 1,930 |       42 |     1,800 | 1,760       |
      Notebook A5  820 |       11 |       760 | 760 accepted|
      Gel pen      690 |       19 |       640 | [600] Save  Accept 640
      Sticky notes 420 |       12 |       400 | [   ] Save  Accept 400
  > Snacks     | 5,210 |       96 |     5,600 | not planned |
  > Toys       |   412 |        7 |       400 | 400         |
```

Its data is one Table, `Reorder Line`: one row per item per month, with `category`, `item`,
`sold_qty`, `sold_value`, `returned_qty`, `returned_value`, `suggested_qty`, `suggested_value`
and `planned_qty`.

## 5. Decision 2: the form a page is saved in

**Agreed (owner, 27-Nov-2026): both rungs, the JSON rung first.**

The three ways the worked example could be saved:

| | Way 1: JSON over a catalog | Way 2: a code page | Way 3: both rungs |
|---|---|---|---|
| The agent sends | A list of parts by name with their settings | React source (TSX) against the shared components | JSON, as way 1 |
| Checked before it shows | Every part, setting, data source and action name, against the catalog. A wrong one is refused by naming the field. No code runs. | It compiles and its imports are limited. No check can say what code will do, so it needs full trust or a sealed frame. | As way 1. A code part was reviewed and tested when it was added. |
| Convert to code | The same JSON file goes into the app's folder in Git. Nothing is redrawn. | The file moves into the app's source. | As way 1 |
| Cannot do | Anything the catalog has no part for | Be drawn by the redesign; be checked before it shows | Make a brand-new part during a meeting |
| Cost to build | Medium: the runtime, the catalog, the save tools | Large: compile at runtime, a sealed frame, a bridge across it for data, saves and record links | Way 1, plus a small registration point for an app's own parts |

**Rung 1** (in a meeting, no deploy): a page is JSON that names parts from the catalog.

**Rung 2** (rare, through Git and CI): when the catalog cannot draw something, a developer adds
one new part as reviewed code in the app's folder. After one deploy, any page uses it by name.

Why not way 2: a page that is code moves the hard problem instead of removing it. It needs a
sandbox, and a sandbox frame is what makes Dash's Dive embedding fiddly today. It also cannot be
drawn by the redesign, which decision 1 rules out.

## 6. A2UI: findings and verdict

A2UI's source was read at commit `36725ee` (25-Nov-2026) of `a2ui-project/a2ui` (the project has
moved from `google/A2UI`). A throwaway proof outside this repository then drew one made-up screen
through A2UI's React renderer with three wrapped `shop-floor` components.

### What its source says

| Earlier summary (24-Nov) | Verdict | Evidence |
|---|---|---|
| A protocol for temporary UI in a chat client | Partly | "Temporary" and "chat" are not in the protocol. Its docs say a screen "can also be authored in advance and sent as a static payload". Since v1.0 one `createSurface` message can hold the parts and the starting data. |
| Spec v1.0, packages 0.16 | Confirmed | `@a2ui/react` and `@a2ui/web_core` 0.16.1, 23-Nov-2026 |
| Renderers for React 17 to 19, Lit, Angular, Flutter, SwiftUI, all client-side | Confirmed | React's own changelog (0.13.0): "the basic catalog no longer server-renders" |
| A basic catalog of 18 low-level parts, no data grid | Confirmed | Its advice for a grid: "nest Columns within this Row" |
| No styling since v1.0 | Partly | `theme` was removed. Layout and variant settings remain on the basic parts. |
| Apps write their own catalog | Confirmed | One JSON Schema document, with guidance text for the model |
| No Tables, queries, permissions, pages or navigation | Confirmed | |

What the earlier summary did not have:

- **The v1.0 syntax differs from v0.9.** A value read from data is `{"@path": "/x"}` and a named
  function is `{"@call": "..."}`. v0.9 catalogs "cannot be used directly with v1.0".
- **Three layers of very different maturity.** The spec says of itself: "This specification is
  stable. Breaking changes go into a future major version." The catalog format is part of the
  spec. The packages are 0.x, release about every two weeks, and mark breaking changes in 0.11,
  0.13, 0.15 and 0.16.
- **The React renderer is not plain React.** Since 0.13 every part is drawn inside a browser custom
  element, and the core package brings Lit with it.
- **Licence:** Apache-2.0.

### What the proof showed

- It works. A static JSON file, a custom catalog only (no A2UI basic part), and wrappers of 11
  lines (toggle), 11 lines (button) and 40 lines (table). The toggle wrote into the page's data
  with no code, each row's button sent its own row id, and the host page could push new rows in.
- It adds 402 kB to the page's script (106 kB compressed): 235 kB without A2UI, 637 kB with it.
- It needs zod 3 (`^3.25.76`). Featherbase is on zod 4 everywhere.
- It cannot draw on the server: `renderToString` throws, and a patched attempt returned an empty
  string.
- Its checking is lenient by default. With strict checking it refuses an unknown part, an unknown
  function and a missing child by name. It never refuses a misspelled optional setting unless the
  schema is made strict, which then refuses one of A2UI's own common settings. It reports the
  first problem only.

### The three questions

**(a) Can Featherbase use A2UI's JSON shape as its saved screen definition?** Yes for the body of
a page, no for the whole page. The body (parts by name in a flat list with ids, settings, children
by id or repeated over an array, `@path`, `@call`, named actions) is written down and declared
stable, and nothing in it is specific to React or to a chat. A2UI has nothing for where data
comes from, what a save means, pages, navigation or who may see what. Those go in an envelope of
Featherbase's own.

**(b) Can it reuse A2UI's React renderer on `main`?** It can: the proof did it. It should not, for
now. Taking it means a second, older copy of zod on the server and in the web app, 402 kB more
script on every runtime page, each part wrapped in an element the library adds (in a web app whose
tests must cover every line in jsdom), and a package that breaks about every two weeks. What it
would save is about 300 lines of our own. Because a saved page depends only on the spec, this
choice can be reversed in either direction without changing a single page.

**(c) What would the same definition need to be drawn as server HTML in the redesign?** A2UI
offers nothing here, so the redesign needs its own drawing code in every option: a walker that
turns the flat list into a tree, the binding rules resolved on the server against rows read as
the viewer, each part as an HTML function (`parts.ts`), and each interaction as an htmx request.
Two rules in this design exist to keep that possible: page state is a small named set that also
lives in the address, and a page has no arithmetic and no code.

### Decision 3: the page body and who draws it

**Taken by default (owner away, 27-Nov-2026): A2UI v1.0's shape for the body, drawn and checked
by Featherbase's own code.** Recommended by Claude; the owner may change it.

- The body of a page follows A2UI v1.0 exactly, in the subset section 7 lists.
- Featherbase checks it with its own checker, written in zod 4 beside its other definitions. It
  reports every wrong field at once, in the refusal shape the MCP already uses
  (`{type, message, fields}`), and it refuses an unknown setting.
- Featherbase draws it with its own renderer. A2UI's packages are not a dependency.
- The proof stays as evidence that A2UI's renderer is a working fallback.

Rejected: **A2UI's renderer, pinned** (for the reasons under (b); this was Claude's first
recommendation, corrected the same day when the zod and bundle facts were found); **our own shape,
borrowing A2UI's ideas** (the 24-Nov recommendation: it would mean designing, documenting and
teaching a grammar that already exists; that research was written about the redesign and did not
weigh that the spec and the renderer can be taken separately).

## 7. The page definition

A page is a row of a platform Table, `Page`. Its columns hold what a list of pages needs: `name`
(its address), `title`, `module` (the group it sits under in the sidebar: the same label a Table carries), `status` (Draft or
Published) and `description`. One more column, `definition`, holds the JSON below.

```
  A SAVED PAGE
  +------------------------------------------+
  | ENVELOPE (Featherbase's own)             |
  |   version   the A2UI spec version: "1.0" |
  |   state     named values, with defaults  |
  |   data      named sources of rows        |
  +------------------------------------------+
  | BODY (A2UI v1.0 shape, unchanged)        |
  |   components: parts in a flat list       |
  +------------------------------------------+
```

### The worked example, in full

```json
{
  "version": "1.0",
  "state": { "measure": "quantity", "open": "" },
  "data": {
    "lines": {
      "table": "Reorder Line",
      "filters": [["month", "=", "2026-12"]],
      "order_by": "category asc"
    }
  },
  "components": [
    { "id": "root", "component": "Page", "title": "Reorder plan, December",
      "actions": ["measure"], "children": ["plan"] },

    { "id": "measure", "component": "Toggle", "label": "Show",
      "options": [ { "value": "value", "label": "Value" },
                   { "value": "quantity", "label": "Quantity" } ],
      "value": { "@path": "/state/measure" } },

    { "id": "plan", "component": "Table", "caption": "Reorder plan",
      "rows": { "@path": "/data/lines" },
      "group_by": "category", "open": { "@path": "/state/open" },
      "bands": [ { "label": "Last month", "columns": ["sold", "returned"] },
                 { "label": "Next month", "columns": ["suggested", "planned"] } ],
      "columns": [
        { "id": "item", "header": "Category", "cell": "item_link" },
        { "id": "sold", "header": "Sold", "align": "end", "format": "number", "total": "sum",
          "value": { "@call": "choose", "args": { "key": { "@path": "/state/measure" },
            "from": { "value": { "@path": "sold_value" }, "quantity": { "@path": "sold_qty" } } } } },
        { "id": "returned", "header": "Returned", "align": "end", "format": "number", "total": "sum",
          "value": { "@call": "choose", "args": { "key": { "@path": "/state/measure" },
            "from": { "value": { "@path": "returned_value" }, "quantity": { "@path": "returned_qty" } } } } },
        { "id": "suggested", "header": "Suggested", "align": "end", "format": "number", "total": "sum",
          "value": { "@call": "choose", "args": { "key": { "@path": "/state/measure" },
            "from": { "value": { "@path": "suggested_value" }, "quantity": { "@path": "suggested_qty" } } } } },
        { "id": "planned", "header": "Planned", "format": "number", "total": "sum",
          "value": { "@path": "planned_qty" }, "cell": "plan_cell" }
      ] },

    { "id": "item_link", "component": "RecordLink", "table": "Reorder Line",
      "row": { "@path": "row_id" }, "label": { "@path": "item" } },

    { "id": "plan_cell", "component": "Row", "children": ["plan_input", "plan_save", "plan_accept"] },
    { "id": "plan_input", "component": "Input", "label": "Planned quantity", "kind": "number",
      "value": { "@path": "planned_qty" } },
    { "id": "plan_save", "component": "Button", "label": "Save",
      "action": { "event": { "name": "save_row", "context": {
        "table": "Reorder Line", "row": { "@path": "row_id" },
        "updated_at": { "@path": "updated_at" },
        "values": { "planned_qty": { "@path": "planned_qty" } } } } } },
    { "id": "plan_accept", "component": "Button", "label": "Accept suggested", "variant": "quiet",
      "action": { "event": { "name": "save_row", "context": {
        "table": "Reorder Line", "row": { "@path": "row_id" },
        "updated_at": { "@path": "updated_at" },
        "values": { "planned_qty": { "@path": "suggested_qty" } } } } } }
  ]
}
```

How to read it:

- **`{"@path": "/state/measure"}`** reads a value from the page. A path that starts with `/` is
  read from the top; one that does not (`"sold_qty"`) is read from the row being drawn.
- **The toggle writes** to `/state/measure`, and every part that reads it follows. State also
  lives in the address (`?measure=value`), so a link opens the page the way it was left.
- **The input writes** to the row's own copy of `planned_qty` on the page. Nothing reaches the
  server until a button fires `save_row`.
- **`choose`** is a named function: it picks one of `from` by `key`. There is no arithmetic. The
  group rows' totals are added up by the `Table` part (`"total": "sum"`).

### The subset of A2UI v1.0 that a page may use

| A2UI v1.0 | In a Featherbase page |
|---|---|
| A flat list of components with `id` and `component`; exactly one `root` | Yes. The root is always a `Page`. |
| Children as a list of ids, or repeated over an array (`{"componentId", "path"}`) | Yes |
| `{"@path": ...}`, absolute and relative; input parts write back at once, locally | Yes |
| `{"@call": name, "args": {...}}` over a fixed list of named functions | Yes |
| `action: {"event": {"name", "context"}}` | Yes. The name is one of Featherbase's actions (decision 6). |
| `action: {"functionCall": ...}`, `@checks`, `@accessibility`, `@metadata`, `@catalogId` | Not yet. Refused as unknown settings, so a page cannot rely on something that is not drawn. |
| The messages (`createSurface`, `updateComponents`, ...) and the calls to and from an agent | No. A saved page is the content of one `createSurface`; there is no agent at view time. |

Featherbase's own setting names are in its API's style (`group_by`, `order_by`); A2UI's own keys
keep A2UI's spelling (`componentId`, `@path`).

## 8. Decisions 4 to 10

Each was put to the owner with options and a recommendation. He was away and had said to take
the recommendation after five minutes, so each is **taken by default (owner away, 27-Nov-2026)**
and open to change.

### Decision 4: the first catalog

**Ten parts, added to only when a real screen needs one.**

| Kind | Parts |
|---|---|
| Layout | `Page`, `Stack`, `Row` |
| Show | `Text`, `Notice`, `RecordLink` |
| Data | `Table`: columns, column bands, groups that open in place, a total per group, any part inside a cell |
| Controls | `Toggle`, `Input`, `Button` |

Named functions: `eq`, `not`, `and`, `or`, `choose`, `formatNumber`, `formatCurrency`,
`formatDate`, `formatString`. Where A2UI's basic catalog has a function of the same name, the
argument names are the same, and fewer of them: Featherbase writes a date one way (DD-Mon-YYYY),
so `formatDate` takes no `format`.

- A part is added with a story, under a name that makes sense without React.
- **No arithmetic in a page.** A page formats and chooses. A derived number comes from the data:
  a Table column, a total the `Table` part adds up, or later a dataset's query.
- Next, each when a screen needs it: `Figure`, `Tag`, `Section`, `Tabs`, `Picker`, `Chart`,
  `Field` (a column's own control, from Table metadata), `List` and `Form` (the generic list view
  and form, embedded).

Rejected: wrapping all of `shop-floor` up front (many are low-level pieces, and it doubles what
the redesign must redraw); starting from the generic list view and form (they cannot draw the
banded, opening table).

### Decision 5: how a page gets its data

**Table rows read as the viewer, plus sample rows marked by the shell. Declared datasets next.**

- A page names its sources in `data`. It never fetches by itself.
- `{"table": ...}` is read through the normal list API as the person looking at the page, so
  grants, Data Scope and sensitive columns apply. A page can show nothing its viewer could not
  already see in the list view. `filters` and `order_by` are the list API's; a filter's value may
  be a `{"@path": "/state/..."}`. A source returns at most 500 rows, and the shell says so when
  there are more.
- `{"sample": [...]}` is rows written in the page. The shell marks the page "Sample data", so a
  page cannot forget to say so.
- Next: `{"dataset": "<app>.<dataset>"}`, an installed app's declared dataset, connected to the
  stand-in datasets work.

Rejected: a page carrying its own query to the warehouse (unreviewed code that decides who sees
what); sample data only (the agreed screen would never meet real rows).

### Decision 6: what a page may save

**Only named actions. Every save is the normal row save, as the viewer.**

| Action | Does | Runs as |
|---|---|---|
| `save_row` | Changes one row (`table`, `row`, `updated_at`, `values`) | The normal row save: the full trigger chain in one transaction, the `updated_at` check, the viewer's grants |
| `create_row` | Adds one row (`table`, `values`) | The same |
| `open_record` | Goes to a record's page | |
| `open_page` | Goes to another page, with its state in the address | |
| `set_state` | Changes page state (`values`) | |
| `run_action` (slice 2) | Runs an installed app's own declared action | That app's reviewed code |

Anything with real logic (accept every line at once, close a month) is an app's declared action:
code in Git with tests, which the page only names. A runtime-only app has no code, so it has only
what Table metadata can check.

Rejected: a multi-step save described in JSON (a rule in JSON instead of code, untested and not
one transaction); read-only pages first (the screen that drifted was an accept-or-change screen).

### Decision 7: creating, keeping, previewing and publishing

**Pages inside the Featherbase shell first. A full runtime app second.**

```
  SLICE 1                               SLICE 2
  +-------------------------------+     +------------------------------+
  | Featherbase shell (as today)  |     | its own address  /reorder/   |
  | sidebar:                      |     | in the app switcher          |
  |   Reorder        <- a GROUP   |     | its own roles and gate       |
  |     Reorder plan <- a PAGE    |     | View as, per role            |
  |     Reorder Line <- a Table   |     | "convert to code" makes it   |
  | address:                      |     | a package in Git             |
  |  /featherbase/admin/page/     |     +------------------------------+
  |          reorder-plan         |       the same saved pages move
  +-------------------------------+       across unchanged
```

- **A page is a row**, so it has the API, history and audit trail every row has. Its history is
  its versions; undo is saving an earlier definition again.
- **"Create an app" in slice 1 is a group**: a name in the sidebar holding its Tables and pages,
  built on the grouping Featherbase already has (a Table's module and its Home page).
- **Draft and Published**, on the page as a whole. A draft is seen only by people who may build.
  A published page is seen by anyone signed in. Data stays protected by each Table's grants.
- **Who may save and publish:** people who may build Tables today (System Managers).

Why not the full app first: an app with its own address runs through the most guarded code in
the server (install, upgrade, activation). A page inside the shell touches none of it.

Not in slice 1: an app's own address and switcher entry; preview as a role (View as is tied to
an app's own role today); a staged draft of a published page (editing a published page changes
it live).

### Decision 8: convert to code

**The page stays JSON. "Code" means a file in Git, reviewed and shipped with the app.** Slice 2.

```
  RUNTIME (rows in Postgres)             CODE (files in Git)

  Page row "reorder-plan"                client-apps/<client>/reorder/
    definition = { ...JSON... }    ->      featherbase.json  (Tables, roles, grants, pages)
  Table definitions                        pages/reorder-plan.json   <- the same JSON
  roles and grants
```

- One tool, `export_app`, returns the files. The agent outside writes them into the repository
  and opens the pull request. Featherbase never writes to Git.
- After install from Git, the same runtime draws the same file. The Tables keep their rows: only
  who owns the definition changes ("promotion never moves data").
- Tested without a hand-written test per page: every page file is checked against the catalog in
  CI; export, install into an empty instance and export again must give identical files; each
  page is drawn once with its sample rows and must draw without an error.

Rejected: generating a React file from the JSON (one-way; the screen becomes redrawn code again
and can drift).

### Decision 9: the MCP tools

**Four tools in slice 1, verb then noun like today's.**

| Tool | Does |
|---|---|
| `list_parts` | The catalog: each part and its settings, the named functions and actions, and one worked example |
| `list_pages` | The pages the caller can open, with module and status |
| `get_page` | One page's definition and its `updated_at` |
| `save_page` | Creates a page, or changes one (pass `updated_at` as read). It checks first: a wrong page is refused, one line per field at fault, and nothing is saved. Returns the page's address. `status` is Draft unless Published is asked for. |

`create_table` gains an optional `module`, so an imported Table lands beside its pages.

Slice 2: `create_app`, `list_apps`, `export_app`; and from the stand-in datasets work,
`list_datasets` and `load_stand_in`. Held for later: `change_part` (replace one part of a page by
its id).

Rejected: a `check_page` and `save_page` pair like the import's (a draft can be taken back
cheaply, so the extra step buys nothing); MotherDuck's `create_page`, `update_page`, `read_page`
(two tools for one act).

### Decision 10: trusted users first

**"Trusted" means one thing: nobody reviews a page before it is published.** Everything else is
held by construction.

In the first version:

- Only people who may build Tables can save or publish a page.
- A page is checked against the catalog on every save. A wrong one is never stored.
- A page reads and saves only as its viewer.
- Every save is in the row's history and the audit trail.
- Sample data is marked by the shell.

Deferred, each addable without changing a saved page: approval before a page is published on
production; per-page role limits; limits on a page's size; a staged draft of a live page. Rung 2
follows the app review rule, and a sandbox is needed only if apps ever arrive unreviewed.

## 9. The first slice

The smallest thing that lets the owner say "create a UI for this" in a meeting and see it inside
the shell.

1. A platform Table, `Page`, with the columns in section 7.
2. A checker for a page's definition, shared by the server and the web app. It reports every
   wrong field at once.
3. Saving a `Page` row runs the checker, and also checks that each named Table and column exists.
   A wrong page is refused and not saved.
4. The MCP tools `list_parts`, `list_pages`, `get_page` and `save_page`; `create_table` takes
   `module`.
5. The runtime in the web app draws a page at `/featherbase/admin/page/<name>`, inside the
   existing shell, with the ten parts of decision 4.
6. A group's Home page lists its published pages beside its Tables, and its drafts for people
   who may build.
7. A draft opened by someone who may not build says the page is not there.
8. Every record a page shows is a `RecordLink`.

Not in the first slice: everything under "slice 2" above; `run_action`; declared datasets.

## 10. What this design did not verify

- The redesign's parts were read, not run. That its HTML can draw every one of the ten parts is
  a reading of `pages.css` and the spike, not a proof.
- The `npm audit` advisory against A2UI's zod 3 was seen in the audit's output and not read.
- A2UI's own claim that v1.0 is stable is theirs; the two breaking revisions before it took
  about a year.
- How the generic list view's styles carry a banded table at 1280 pixels with real, wide data is
  for the build's verifier to show. Made-up data is narrower than real data.
