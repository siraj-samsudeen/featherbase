# #1340 Business roles screens follow Featherbase

Spec: the issue body, items 1–13. Mockup: Business Roles in Featherbase, boards 1–5.

## What Featherbase already gives (checked on a made-up instance, 19-Nov-2026)

- `dash.business_role` and its linked Tables are manifest Tables: the shared list, the record page
  (path, title, chips that jump, Form · Links · Map · Activity, Record actions) already draw them.
- The Links tab already lists each Table pointing at a role; the report grants already read as the
  shared tick list (`LinkTickList`, "N of M", Open as grid).
- What it cannot know: a permission row read as a sentence, the headings the business uses, a role's
  people (worked out from HR titles and hand changes, not rows), the header line, the list's derived
  columns, and list-level actions such as Add The Starting Roles.

## The one platform piece: app record facts

Like `why` (#1282), an app declares in its manifest `records: { "<table>": { "describe": "<read>" } }`.
The platform runs that read as the viewer with `{ table, rows, page }`, checks the answer against one
versioned shape (`packages/shared/src/record-facts.ts`), names any record the viewer may not read
neutrally, and refuses the answer whole if it is not that shape. Any failure (refused, not installed,
wrong shape) means no facts: the generic page as today. So who sees what is still the app's read.

| Answer part | Drawn by |
|---|---|
| `columns` + each row's `facts` | `ListView`/`ListRow`: cells after the Table's own columns (text, or a status pill) |
| `actions` (label, one-line explanation, `run` an app action or `href` a page) | `ListView`: a Record actions menu beside More |
| each row's `header` | `FormView`: the line under the title |
| each row's `groups` | `RecordLinks` + the title chips: a group may stand for a link group (`table`: its heading, a sentence per row, a note per tick line) or be the app's own (`lines`, Show all / Open as list) |

A second shared piece: **a preview-then-run page** (`/featherbase/admin/table/$table/run/$action`). An
action with `preview` opens it: path "<Table> / <action>", title with Cancel and Run, one sentence,
filter chips with counts, the shared list table, a note. Nothing is saved until Run.

Migrations gain `moveTable` (a Table's module; nothing else changes) and `alterColumn` may change
`in_list_view` (display only).

## Spec items → where

| # | Where |
|---|---|
| 1 | Dash 0.13.40 migration: the four Tables move to module People; Report access relabelled Report grant. Admin list/record pages draw them; Dash's Business Roles page is deleted |
| 2 | `in_list_view` off for Description and Given by hand only; Dash's describe read gives People, Given By, What They Can Do, Reports, Opens Dash; Reaches is the shared Choice rendering; Name is the row link |
| 3 | `FormView` header line from the facts ("Business role · 25 people · from HR title and by hand"); chips, tabs, path are the existing shell |
| 4 | Links groups from the facts: What They Can Do (one `Sentence` per permission, its reach a chip, Open as grid → Dash grid page), Reports (the existing tick list, each line noting the other roles holding it), HR Titles That Give It, People (from HR / given by hand chips, first 10, Show all / Open as list) |
| 5 | Record actions on the Business Role list: Add The Starting Roles (runs `add_starting_roles`), Give Old Grants To Business Roles… (opens the preview page), Dash Access Source with its rollback sentence (opens the source record or its list) |
| 6 | Preview page fed by a new Dash read `give_old_grants_preview` (the same computation the action runs, writing nothing); Run calls `give_old_grants_to_roles` |
| 7 | New `dash.setup_run`: one row per run, titled with its counts; each log line links to its run, so the detail is the run's Links tab; the run's creation is in Activity |
| 8 | Dash menu: Explain A Person, Who Would Gain Or Lose Access, and Business Roles ↗ to the Featherbase list |
| 9 | `ExplainPersonPage` rebuilt: shared `PersonPicker`, header as a record page, answer-first sentence, `FieldGrid` fields, sections of locked tick lines (a shared `TickLine` in shop-floor, also used by the admin tick list), via chips, Why? |
| 10 | `AccessChangesPage` rebuilt answer-first: checked date + Check again, status pill, Export CSV, headline, four finding cards as filters, Need A Decision cards (Give A Role… opens Explain with the form; Let Them Lose Dash records a decision in new `dash.access_decision`), Everyone Who Changes as `DataList` with filter chips and search |
| 11 | Shared components only; design guards stay green |
| 12 | `BusinessRolesPage` and its helpers deleted; `?view=roles` redirects to the Featherbase list; the Grid stays as Dash's grid page, reached by Open as grid |
| 13 | Reads and actions keep their policies and checks; the describe and preview reads call `managersOnly` as the page reads did; comparison code untouched |

Not done here: phone layouts (desktop first).
