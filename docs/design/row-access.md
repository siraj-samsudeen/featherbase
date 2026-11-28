# Row access: every Table says who reads which of its rows

Issue [#1459](https://github.com/siraj-samsudeen/featherbase/issues/1459). The promises are in
`openspec/specs/row-access/spec.md`; this page is the audit, the choices and why. Every name, store and
figure used to check it is made up (`pnpm dev jeyarama/dash --made-up-data`); production was not read.

## Decisions for the owner

Each has a recommendation, and the recommendation is what is built.

1. **Existing Tables keep reading whole after the upgrade, said out loud.** The migration gives every
   platform Table and every Table an instance already made the rule `all` (every row, to whoever a grant
   reaches), so nothing a live instance does today stops. Only a Table made *after* the upgrade starts
   closed. The alternative is to close them all and open each by hand: safer on paper, but it stops Dash's
   masters (Site, Employee, Job Assignment and the rest) for Master Data Editors until someone sets 20 rules.
   *Recommended: keep, then review the list (`GET /api/row_rules`).*
2. **Tickets: everyone who signs in reads every ticket.** The app grants `All` on `tickets.ticket`,
   `tickets.progress`, `tickets.member` and five more. The new rule cannot fix this alone: tickets name their
   raiser and assignee as text, not as a link to Person. *Recommended: a Tickets change that links them, then
   the rule `own` on raiser and assignee with `whole_for: Tickets Support`. Until then the app declares `all`,
   as it behaves today.*
3. **Forecasting's older Tables are not about places yet.** `forecasting.number`, `decision`, `explanation`,
   `run_line`, `reach`, `review_question`, `idea` and their notes carry a store but no subcategory code, so a
   Forecasting Member reads all stores' rows of them. `forecasting.reach` lists people and whom they report
   to. *Recommended: add `subcategory_code` where the row has a subcategory and move them to `places`; give
   `reach` the rule `administrators` if only the job needs it. They declare `all` until the owner confirms
   the app still works that way.*
4. **Equipment and Tasker read whole within their role.** Any Assets Member reads every asset at every store;
   any Tasker Member reads every shared task. Their mandatory access policies (roles, shared, inherited) stay
   as they are. *Recommended: Equipment by `places` (its place is a store) in its own change; Tasker stays.*
5. **A screen for the rule.** A System Manager sets a Table's rule through the API or MCP today
   (`PUT /api/table_def/<table>/row_rule`). The Table builder and the import wizard make a Table with no
   rule, so it is closed until one is set. A UI change takes the UI route (mockups, checklist, verifier),
   which needs the owner. *Recommended: add "Who reads its rows" to the Table's settings and to both
   creation flows before this reaches a live instance.*
6. **The base branch does not load Forecasting.** On `issue-1453-app-roles-from-org-chart` the manifest's
   `scopedTables` names `forecast_month` (a Date) as a key, which the platform refuses, so the whole app is
   rejected at start. This change removes `scopedTables` (and its unused `keys`), which fixes it here; the
   two draft PRs below this one still carry it.

## What the audit found

One local instance with the five apps and made-up data: 164 Tables that are not Sub-tables. Before this
change, a grant with no "own rows" limit read the whole Table, and the only things that narrowed rows were
own-rows grants, a person's Data Scope, a mandatory access policy and, since #1454, places.

| Tables | Who reads | Which rows, before |
|---|---|---|
| Platform's own (59 and System Settings) | No one by default; `Glossary Term` is granted to `All` | Every row |
| Dash's masters: Site, Plant, Section, Employee, Job Assignment, Merchandise Assignment and 14 more | Master Data Editor | Every row |
| `dash.report` | Dash Reader, which System Settings gives **everyone who signs in** | Every row (the list of reports, not their figures) |
| Dash's 12 access Tables | Report Access Manager; Team Report Manager (own rows on `report_access`) | Every row |
| Forecasting's 11 read-only copies with places, and 4 review Tables | Forecasting Member | Within the person's places (#1454) |
| `forecasting.forecast_run`, `item_stock` (copies declared unscoped) | Forecasting Member | Every row, on purpose |
| Forecasting's other 11 Tables | Forecasting Member | Every row (decision 3) |
| Equipment's 25 Tables | Assets roles, by policy | Every row (decision 4) |
| Tasker's 8 Tables | Tasker Member, by policy | Shared rows and one's own (the policy) |
| **Tickets' 8 Tables** | **`All`: everyone who signs in** | **Every row**, but own rows on `request` and `event` (decision 2) |

So "anybody who signs in can see everything" is true of Tickets and of the report list, and "everyone
holding the app's role reads every store" is true of Equipment and of half of Forecasting. The platform
itself was closed at the Table (no grant, no read) but had no way to say "these rows only" except per
person, and nothing made an author say anything.

## The model

A grant decides **who reaches a Table** and with which operations. The Table's **row rule** decides
**which rows**. Every Table has exactly one rule, from a closed set:

| Kind | A person reads | Example |
|---|---|---|
| `all` | every row | a list of countries; the report catalogue |
| `own` | rows they created, and rows naming them in the Person columns the rule lists | a request and its assignee |
| `places` | rows within their places on the org chart, by a scope filter → column mapping; and rows they created | a forecast line at their store and subcategory |
| `through` | rows whose reference names a row they can read | a task, by its project |
| `administrators` | nothing; System Managers only | a job's working Table |
| *(none declared)* | nothing; System Managers only | any Table nobody has thought about |

`own`, `places` and `through` may name `whole_for`: roles that read every row (a head-office role). The
role still needs a grant to reach the Table.

What the rule takes in, and what stays beside it:

- **Places** (#1454) are the kind `places`. `scopedTables` is gone; a read-only copy still says it through
  its dataset (`filters` are its places, `unscoped` is `all`), so nothing is declared twice.
- **Own rows**: the kind `own` is the Table's; a grant's "own rows only" stays, as the narrower reading one
  role gets of a Table others read more of.
- **Sub-table rows** follow the row that holds them, and **Comments, Versions and Files** the row they are
  on. These were already `through`, fixed by the platform; they now follow the parent's rule too.
- **Data Scope** is not a kind. It is what a System Manager adds for one person on one instance ("only the
  north stores"), on top of any rule. A Table's rule is about the Table; Data Scope is about the person.
- **A mandatory access policy** (Tasker, Equipment) also stays beside the rule: it binds System Managers
  too, which a rule never does.

## Choices, and why

- **The default is closed.** A Table with no rule answers no rows, refuses every single-row read and every
  write, for everyone but a System Manager. A stored rule this version cannot read, an app whose files are
  not loaded, and a ring of `through` rules are closed as well. An open default is how a new Table leaks;
  a closed one is noticed the first time someone opens it.
- **One place applies it.** `row-rule.ts` gives the SQL condition (`scopedWhere`, so lists, counts, charts,
  search, row titles, related filters, the rows behind a Comment) and the single-row check
  (`assertUserPermissions`, so opening a row and every write). Nothing reads a rule on its own.
- **A System Manager is not narrowed**, as Data Scope does not narrow them. The server's own actor is one.
- **View As** runs a read as the person viewed, so their rule applies; it offers no change, as before.
- **Jobs and an app's declared reads** of instance Tables (`baseTables`, the scope provider) run as the
  platform, not as a person: they are what the app declared and a System Manager installed. A read an app
  makes *for a person* (its `documents`, its datasets) is narrowed as that person.
- **MCP and the HTTP API** are the same reads with the person's token, so the same rule.
- **Exports** are built by the browser from list reads, so they hold what the list holds.
- **Realtime**: an update on a Table whose rule is not `all` is checked row by row with the read the API
  serves; a deleted row, which can no longer be judged, is sent to System Managers only.
- **A connected Table** (rows on an outside database) is `all` or closed. Its rows are not ours to filter by
  creator or place yet; say so rather than half-apply a rule.
- **A Settings Table** has one row: `all` or `administrators`.
- **An app declares its rules in its manifest** (`rowRules`, Table → rule), checked when its files load: the
  Table is its own, and the columns exist and suit the kind. The rule is read from the loaded manifest, so
  an upgrade needs no migration step and an app that fails to load closes its Tables.
- **An instance overrides** with a System Manager's own rule on the Table (`table_def.row_rule`), which
  wins over the app's; clearing it returns to the app's. For the platform's and the instance's own Tables
  that column is the rule. Every change is in the Access Log.
- **`through` asks the target with the reader's own list query**, so the target's grant, rule, Data Scope
  and policy all apply. A Table cannot be read through itself, and a ring ends closed after four Tables.
- **Values compare as text** for places, as a dataset read's do; only plain columns can be mapped.
- **Cost.** `all` adds nothing to a query. `own` is one indexed comparison, `places` the same `IN` lists
  #1454 measured, `through` one `IN (subquery)`. Roles and places are read once per request.

## Moving a live instance

1. The migration adds the column and gives every existing platform and instance Table `all` (decision 1).
2. Each app ships its rules in the same change: Dash, Equipment, Tasker and Tickets declare what they do
   today; Forecasting moves its four review Tables from `scopedTables` to `places`. Each has a new version.
   Until an instance takes the new app version, that app's Tables are closed to everyone but System
   Managers, so the platform and the apps go out together (`docs/DEPLOY.md`).
3. A Table made afterwards is closed until it is given a rule.
4. `GET /api/row_rules` (System Manager) lists every Table's rule, who said it, the Tables with none and the
   Tables everyone who signs in reads whole. `pnpm check:row-rules` fails when an app in this repo leaves
   one of its Tables without a rule.

## Deliberately not handled

- A rule per operation (read one way, write another): the grant already carries operations.
- Rules combined with "or": `whole_for` covers the case that came up.
- Places or own rows on a connected Table.
