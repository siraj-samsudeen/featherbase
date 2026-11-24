# Budgets App: Data Model

The Budgets app holds the finance team's budgets and the working tables of the monthly close.
It replaces an Excel working file in which a trial balance is given a P&L line and a store by
hand, manual lines are added, shared costs are spread across stores and the result is compared
with a budget kept in another workbook.

Every name, person and amount in this document is made up.

## The Picture

```
                         existing Featherbase tables (linked, never copied)
   Legal Company    Site ── Plant ── Profit Centre ── Cost Centre    Business Line Segment
        │                     │                                              │
        │                     │                                              │
 ┌──────┴─────────┐   ┌───────┴────────────────────────────┐   ┌────────────┴───────────┐
 │  THE CLOSE     │   │  BUDGETS                           │   │  RULES                 │
 │                │   │                                    │   │                        │
 │ Monthly Close    │   │ Budget Version                     │   │ P&L Line  (self-link)  │
 │   │            │   │   ├─ P&L Budget   (plant×month×line)│   │   ▲                    │
 │   └─ Close     │   │   ├─ Sales Budget (plant×month×     │   │ GL Account             │
 │      Adjustment│   │   │                subcategory)     │   │   └─ GL Account Split  │
 │        │       │   │   └─ Budget Store Plan              │   │ Allocation Rule        │
 │        └─ Ticket   │                                    │   │   ├─ Rule Segment      │
 │  (Monthly      │   │                                    │   │   └─ Rule Store        │
 │   Closing      │   │                                    │   │                        │
 │   Follow-up)   │   └────────────────────────────────────┘   └────────────────────────┘
 └────────────────┘
                 actual figures are read from the warehouse, never stored here
```

Three groups, twelve tables. Every table is named `budgets.<name>` and belongs to the app, so
one access list covers all of them.

## What Is Linked, Not Copied

| Need | Existing table | How Budgets uses it |
|---|---|---|
| The store | Plant | Every figure is held against a plant. The store's name, site, format and company are read through the link. |
| Opening date, planned or open | Site (`opened_on`, `status`) | Read through Plant → Site. Not repeated. |
| Company of a close | Legal Company | Monthly Close links to it. |
| Where SAP books a cost | Cost Centre, Profit Centre | Optional links on a Monthly Close Adjustment, as in the trial balance. |
| Fashion, Grocery, Home | Business Line Segment | The basis of an allocation rule names segments. |
| Rented or owned | Building (`tenure`), Rent Contract | Shown beside notional rent; not repeated. |
| A store's area over time | Store Area (Organisation) | Read for area-based allocation and every per-sq-ft charge, and shown read-only on the Store Areas screen with a link to the record. Kept in Organisation because every report needs it, not only finance. |
| Merchandise level | Subcategory | The sales budget's lowest level. |
| People | Person | Owner of an adjustment, who approved a version. Held as the person's ID and shown as a link, because Budgets people cannot read the Person table. |
| Follow-ups | Ticket, Ticket type | One ticket type, "Monthly Close Follow-up". |

## Rules

### P&L Line (`budgets.pl_line`)

One row per line of the P&L, at both levels. A working line (Salaries, PF, ESI) rolls into a
published line (Manpower Cost). Subtotals (Gross Margin, Store EBITDA) are rows too, so the
order and the layout of the P&L are data, not code. Key: `line_key`.

| Column | Type | Notes |
|---|---|---|
| `line_key` | Data, unique | Short stable key, such as `manpower_cost` |
| `line_name` | Data | The name people read |
| `level` | Choice | Working, Published |
| `rolls_into` | Reference → P&L Line | The published line a working line adds to. Blank on a published line. |
| `line_order` | Int | Position in the P&L |
| `section` | Choice | Sales, Margin, Store Opex, Below Store EBITDA, Below EBITDA |
| `line_kind` | Choice | Posted (from the ledger), Allocated (from an allocation rule), Standing Charge, Subtotal, Memo |
| `sign` | Choice | Income, Cost. A cost is entered as a positive amount and subtracted. |
| `subtotal_rule` | Choice | Running Total (everything above it), Section Total (its section only). Subtotals only. |
| `shows_per_sqft_day` | Check | Whether the published P&L shows rupees per sq ft per day for this line |

Example: `salaries` · Salaries · Working · rolls into Manpower Cost · order 410 · Store Opex ·
Posted · Cost.

### GL Account (`budgets.gl_account`)

One row per SAP account. The account's code, name and statement come from SAP; its P&L line
and store rule are the controller's. Key: `account_code`.

| Column | Type | Notes |
|---|---|---|
| `account_code` | Data, unique | SAP's account number |
| `account_name` | Data | SAP's name |
| `statement` | Choice | P&L, Balance Sheet |
| `pl_line` | Reference → P&L Line | A working line. Blank means not classified yet. |
| `store_rule` | Choice | Plant, Cost Centre, Profit Centre: the SAP field that gives the store |
| `falls_back_to_cost_centre` | Check | For a Plant-rule account, use the cost centre when the plant is blank |
| `note` | Text | |

Example: `49990001` · Staff Tea And Snacks · P&L · line Staff Welfare · store rule Cost Centre.

Every change is kept in the row's history (who, when, before and after), because rule edits need
no approval but must be traceable.

### GL Account Split (`budgets.gl_account_split`)

An exception to an account's line for one store or one region, dated. It answers "this account
goes to another line here", in whole or in part. Key: series `SPLIT-.####`.

| Column | Type | Notes |
|---|---|---|
| `gl_account` | Reference → GL Account | |
| `plant` | Reference → Plant | One store. Blank when the split is for a region. |
| `operating_region` | Reference → Operating Region | A whole region. Blank when the split is for one store. |
| `pl_line` | Reference → P&L Line | The line this share goes to |
| `share_percent` | Float | The shares of one account at one place add up to 100 |
| `starts_on`, `ends_on` | Date | |

Example: account Drinking Water at plant 9004 Lakeside: 70% to Electricity & Fuel, from
01-Apr-2026 (a second row sends 30% to Staff Welfare).

### Allocation Rule (`budgets.allocation_rule`)

One row per shared cost that is spread across stores, and per standing charge that has no book
entry. Key: series `RULE-.###`.

| Column | Type | Notes |
|---|---|---|
| `rule_name` | Data | |
| `rule_kind` | Choice | Allocate A Cost Pool, Standing Charge |
| `run_order` | Int | Rules run in this order |
| `source_plant` | Reference → Plant | The pool: a warehouse's or head office's whole cost. Blank when the pool is a line. |
| `source_line` | Reference → P&L Line | The pool: one line across the region, such as Marketing |
| `target_line` | Reference → P&L Line | The line the stores receive it on |
| `basis` | Choice | Store Area, Net Sales, Net Sales Of Named Segments, Inventory, Rate Per Sq Ft, Fixed Share. Store Area and Rate Per Sq Ft read Organisation's Store Area: the row in force is the latest `starts_on` on or before the day. |
| `rate_per_sqft` | Currency | Rate Per Sq Ft only: rupees per sq ft a month |
| `operating_region` | Reference → Operating Region | The stores that receive it |
| `starts_on`, `ends_on` | Date | A changed rule is a new row from a date; the old one ends |
| `note` | Text | |

Example: `RULE-004` · Northgate Warehouse Cost · Allocate A Cost Pool · order 20 · source plant
9101 Northgate Warehouse · target Warehouse Cost - Allocated · Net Sales Of Named Segments ·
region North · from 01-Apr-2026.

### Allocation Rule Segment (`budgets.allocation_rule_segment`)

The segments a "Net Sales Of Named Segments" basis counts. Key: series.

| Column | Type |
|---|---|
| `allocation_rule` | Reference → Allocation Rule |
| `business_line_segment` | Reference → Business Line Segment |

Example: `RULE-004` · Fashion & Lifestyle.

### Allocation Rule Store (`budgets.allocation_rule_store`)

A store treated differently by one rule. Key: series.

| Column | Type | Notes |
|---|---|---|
| `allocation_rule` | Reference → Allocation Rule | |
| `plant` | Reference → Plant | |
| `treatment` | Choice | Included (a rule that names its stores), Excluded, Fixed Share, Fixed Amount |
| `share_percent` | Float | Fixed Share |
| `amount` | Currency | Fixed Amount |
| `area_sqft` | Float | The area this rule charges for, when it is not the store's whole area |

Example: `RULE-009` Notional Rent · plant 9003 Hilltop · Included.

## Budgets

### Budget Version (`budgets.budget_version`)

A budget as approved at one time. A revision is a new version that covers the months it
changes. **The budget for a month is the latest approved version that covers that month**, for
that kind and region. Key: series `BV-.###`.

| Column | Type | Notes |
|---|---|---|
| `version_name` | Data | Such as "FY27 Original" |
| `budget_kind` | Choice | P&L, Sales |
| `fiscal_year` | Data | Such as FY27 |
| `operating_region` | Reference → Operating Region | Blank when it covers every region |
| `covers_from`, `covers_to` | Date | First and last month covered |
| `version_state` | Choice | Draft, Approved, Withdrawn |
| `approved_at` | Datetime | Set by the server on approval; of two approved the same day, the later is in force |
| `approved_by` | Data | The person's ID; the app shows their name as a link |
| `based_on` | Reference → Budget Version | The version this one revises |
| `source_file` | Data | The workbook it was loaded from |
| `note` | Text | Why it was revised |

Example: `BV-002` · FY27 Revision 1 · P&L · FY27 · region North · Oct'26 to Mar'27 · Approved
14-Oct-2026 · based on `BV-001`.

### P&L Budget (`budgets.pl_budget`)

The budget itself: one amount per version, store, month and published line. Key: series.

| Column | Type | Notes |
|---|---|---|
| `budget_version` | Reference → Budget Version | |
| `plant` | Reference → Plant | |
| `budget_month` | Date | First day of the month |
| `pl_line` | Reference → P&L Line | A published line, never a subtotal |
| `amount` | Currency | Rupees, exact. Screens show lakhs. |

A version, plant, month and line appear once. Subtotals are worked out, not stored, so a
changed line can never disagree with its total.

A revision holds only the figures it changes. For the months it covers, every other figure
is read from the version it is based on. So revising is immediate, and a revision's rows are
exactly what it changed.

Example: `BV-001` · plant 9003 Hilltop · Oct'26 · Manpower Cost · ₹18,40,000.00.

### Budget Store Plan (`budgets.budget_store_plan`)

What a version assumed about a store that is not yet open or is changing size. Key: series.

| Column | Type | Notes |
|---|---|---|
| `budget_version` | Reference → Budget Version | |
| `plant` | Reference → Plant | |
| `planned_opening_on` | Date | The actual opening date stays on the Site |
| `planned_area_sqft` | Float | |
| `note` | Text | |

Example: `BV-001` · plant 9009 Harbour Road · opens 15-Jan-2027 · 31,000 sq ft.

### Sales Budget (`budgets.sales_budget`)

The sales budget at its lowest level. A one-month re-target is a version covering that month.
Key: series.

| Column | Type |
|---|---|
| `budget_version` | Reference → Budget Version (kind Sales) |
| `plant` | Reference → Plant |
| `budget_month` | Date |
| `subcategory` | Reference → Subcategory |
| `budget_quantity` | Float |
| `budget_value` | Currency |

Example: `BV-003` · plant 9003 Hilltop · Oct'26 · subcategory Kurti · 420 · ₹3,15,000.00.

## The Close

### Monthly Close (`budgets.monthly_close`)

One publication of one company's month. Republishing makes the next version. The download time
is the cut: a posting entered in SAP after it is not part of this close. Key: series
`CLOSE-.####`.

| Column | Type | Notes |
|---|---|---|
| `legal_company` | Reference → Legal Company | |
| `close_month` | Date | First day of the month |
| `version_no` | Int | 1, 2, 3 |
| `downloaded_at` | Datetime | When the trial balance was downloaded. Stored in UTC, shown in IST. |
| `close_state` | Choice | Open, Published, Replaced |
| `published_at` | Datetime | Set by the server on publication |
| `published_by` | Data | The person's ID |
| `note` | Text | |

A company, month and version appear once.

Example: `CLOSE-0007` · company 9000 Example Retail · Oct'26 · version 2 · downloaded
09-Nov-2026 18:35 IST · Published 11-Nov-2026.

### Monthly Close Adjustment (`budgets.monthly_close_adjustment`)

One manual line of a close. Key: series `ADJ-.#####`.

| Column | Type | Notes |
|---|---|---|
| `monthly_close` | Reference → Monthly Close | The version that first carried it. Later versions of the month carry it too, until it is withdrawn. |
| `withdrawn_in` | Reference → Monthly Close | The version that dropped it |
| `plant` | Reference → Plant | The store |
| `gl_account` | Reference → GL Account | |
| `pl_line` | Reference → P&L Line | Starts as the account's line; changed for a regrouping |
| `amount` | Currency | Positive adds to the line, negative takes away |
| `adjustment_type` | Choice | Provision, Reallocation, Capitalise, Defer, Recover |
| `reason` | Text | The same words on every line of one entry, so the list groups by it. As long as the controller wrote it. |
| `owner` | Data | The person's ID: who will see it through |
| `cost_centre`, `profit_centre` | Reference | Optional, as in the trial balance |
| `corrects_sap_document` | Data | The SAP document this line corrects |
| `reverses` | Reference → Monthly Close Adjustment | Last month's line that this one reverses |
| `adjustment_state` | Choice | Open, Posted In SAP, Released, Carried Forward |
| `matched_sap_document` | Data | The SAP posting that settled it |
| `matched_amount` | Currency | |
| `remaining_amount` | Currency | Amount less matched amount, kept by the server |
| `ticket` | Data | The follow-up ticket's ID, if one was raised |

Example: `ADJ-00231` · `CLOSE-0007` · plant 9003 Hilltop · account 49990001 · Staff Welfare ·
₹42,500.00 · Provision · "Provision for October electricity bill not received" · owner Asha
Verma · Open · remaining ₹42,500.00.

### Ticket Type: Monthly Close Follow-up

A row in the Tickets app's Ticket type table, not a table of its own. A Monthly Close Adjustment or a
Monthly Close links to the ticket raised for it. Open follow-ups are a list in the Budgets app.

## Dated And Versioned

| Table | How change over time is held |
|---|---|
| Budget Version, Monthly Close | Numbered versions; an old version is never edited after it is approved or published |
| P&L Budget, Sales Budget, Budget Store Plan | Belong to a version |
| Allocation Rule, GL Account Split | `starts_on` and `ends_on` |
| GL Account, P&L Line | The current value, with the platform's row history |
| Monthly Close Adjustment | State, plus the version that first carried it and the one that withdrew it |

## What Is Not Stored Here

- **Actual figures.** The ledger and the computed P&L stay in the warehouse. The app reads them
  for its summaries and holds no copy.
- **Subtotals and per-sq-ft figures.** Worked out from lines, areas and days open.
- **Store vintage** (like-for-like, opened last year, new). Read from the Site's opening date.
- **Budget assumptions** (growth, margin and shrink percentages behind a budget). The budget
  amounts are held; the model that produced them stays in the workbook for now.

## Access

Two roles, both declared by the app. Nobody else sees the app.

| Role | Who | Can |
|---|---|---|
| Budget Editor | The financial controller | Read, create, change and retire rows in every Budgets table; import; approve a budget version; publish a close |
| Budget Viewer | The owner directors. For now also the platform owner and the service account an AI assistant reads through (temporary, to be confirmed). | Read every Budgets table and every summary. Change nothing. |

Enforced by the platform's own model, with nothing new:

- **A ceiling on every table.** Each Budgets table carries
  `access_policy: {version: 1, roles: ["Budget Editor", "Budget Viewer"]}`. The platform checks
  it before anything else: a person holding neither role gets nothing, a System Manager
  included, and no share or "everyone" setting can widen it. It applies the same way in the
  app, the Admin's list view, search and a connector.
- **Grants under the ceiling.** Each table has one `permissions` row per role: Budget Editor
  with read, write, create and delete; Budget Viewer with read only.
- **The app itself.** It is listed in the app switcher, and its server answers, only for
  someone who can read its entry table. Its writing operations check for Budget Editor again.
- **The organisation's tables.** Stores, companies, regions, segments and subcategories are read through the instance's own role for them (Featherbase Viewer on the client's instance). A Budgets person holds that role too; without it they see codes without names and the app's operations refuse them.
- **Giving a role.** A System Manager maps a person or an instance role to an app role in the
  Admin (Apps → Configure Role Mappings). The app ships no default mapping, so on a fresh
  install nobody has either role until one is given.
- **The warehouse figures.** The app's server reads actuals through a declared dataset; a
  browser never sends a query. Only a person who can open the app can call that read.

What a Viewer sees on each screen:

| Screen | Viewer can | Viewer cannot |
|---|---|---|
| P&L, Store P&L, Bridge | Open, change month, region and version, drill into a figure | Nothing to change here |
| Budgets | Open a version, compare versions | Revise, edit a figure, import, approve |
| Monthly Close | Open a close, read its adjustments and after-close postings | Add or paste adjustments, match a posting, publish |
| Accounts, P&L Lines | Read, group, filter | Classify, bulk change |
| Allocation Rules | Read | Add, change, end |
| Store Areas | Read, and open the Organisation record where they may | Nothing to change here: nobody edits a store's area in Budgets |
| Follow-ups | Read | Raise or close a ticket |

A control a person may not use is not drawn.

## Decisions Made For The Owner To Review

The owner was away while this was designed and asked for the choices to be recorded for review
afterwards. Each is reversible before the first real data is loaded.

**1. One long budget table, at the published line.** A budget is rows of version, store, month
and line, not a sheet per store. Chosen over keeping a sheet-shaped table (twelve month
columns) because every Excel view becomes a pivot of one table, a bulk change is a filter, and
a new store or line needs no new column. Subtotals are worked out, never stored.

**2. A version covers a range of months, and a revision holds only what it changes.** The
budget for a month is the latest approved version covering it; a figure the revision did not
change is read from the version it is based on. Chosen over "a revision is a full copy"
because the same rule serves a mid-year P&L revision and a one-month sales re-target, a
revision's rows are exactly its changes, and revising is immediate (copying a half-year for
five stores took over a minute). Cost: reading a budget means reading through the versions it
is based on; one function does that for every page.

**3. P&L lines, both levels and the subtotals, are one table.** Chosen over separate working
and published tables because the roll-up is then a link and the P&L's order is data the
controller can change.

**4. Actuals are read from the warehouse, not copied in.** Chosen over loading each published
close into a Featherbase table because the repo removed such copies from Dash (#1366) and a
copy is a second place for a figure to be wrong. Cost: the budget-against-actual and bridge
screens need the warehouse's P&L model and a connection that may read it. Until both exist
those screens show the budget and say that actuals are not connected.

**5. A hard ceiling on every table.** Chosen over ordinary grants because ordinary grants let
every System Manager read the budgets. Cost: a System Manager who is not given a Budgets role
cannot help with a row they cannot see.

**6. Stores, companies, segments and subcategories are real links.** Chosen over storing codes
as text because the brief asks for linking and navigation. Cost: the app installs only on an
instance that has those tables.

**7. An adjustment is one line for one store; an entry across stores shares its reason.**
Chosen over a header with lines because the close needs each line's own state, match and
remaining amount, and the list already groups by reason.

**8. An adjustment belongs to the version that first carried it.** Later versions of the month
carry it until one withdraws it. Chosen over copying lines into each version, which would give
one provision several rows to match.

**9. The sales budget is held at subcategory.** Chosen over store and segment only because the
source and the monthly re-targets are at subcategory. Cost: about two lakh rows a version.

**10. Budget assumptions are not modelled yet.** The growth, margin and shrink percentages
behind a budget stay in the workbook. The amounts they produce are held.

**11. The app has its own paste and import.** The Admin's import is for System Managers only,
who cannot see these tables. Pasting rows from Excel and the figures matrix are built as shared
components for every app.

**12. Amounts are stored exact, in rupees.** Summaries show lakhs to two decimals, as the
Excel P&L does; a figure that must foot is shown exact.

**13. The ticket type is set up on the instance.** The platform has no way for an app to ship a
row of another app's table, so a System Manager adds "Monthly Close Follow-up" once.

**14. Nothing is deleted.** A Budget Editor cannot delete a version, a figure, a store plan,
a close or an adjustment. A wrong figure is changed, a wrong version is withdrawn, and an
adjustment is withdrawn in a later version of its close. Chosen because the platform's delete
does not run the rules that protect an approved budget or a published close.

**15. Who and when are the server's word.** Approving a version or publishing a close stamps
the person and the instant on the server; a save cannot name someone else or another time. A
published close cannot be opened again, and a figure or an adjustment cannot be moved to
another version or close.

**16. One Store By Month shows one kind of figure at a time.** Budget, Actual or Variance is
chosen by a control, so twelve months and the year to date fit one screen. The Excel sheet
puts budget and actual side by side for every month, which needs sideways scrolling.

**17. Budgets is not yet listed in the client's instance.** Listing it installs it wherever
the instance is set up, and it installs only where the organisation's tables exist. Until
the owner decides, a System Manager installs it from Apps on the instance.

**18. One family of names for the close: Monthly Close.** The table is Monthly Close, its
manual line is Monthly Close Adjustment, and the ticket type is Monthly Close Follow-up. The
owner's words were "monthly closing follow-up or something like that"; one stem is used so the
same thing has the same word everywhere. On screen a line is called an adjustment once the
page has said which close it belongs to.

**19. Store area lives in Organisation, not in Budgets.** Budgets first had its own Store Area
table. It is removed: a store's area feeds every reader (sales per sq ft, store format), so it
cannot sit behind the finance ceiling, and one thing has one home. Budgets reads Organisation's
Store Area (`plant`, `starts_on`, `total_sqft`, `fashion_sqft`, `grocery_sqft`, `home_sqft`,
`gold_sqft`, `note`; no end date, the row in force is the latest that has started) and shows it
read-only. A Budget Editor does not edit it. An allocation rule's own `area_sqft` for one
store stays in Budgets: it is the part of a store a rule charges for, not the store's area.

Known limit: saving figures costs about 80 ms each on a quiet machine, so a pasted block of
a few hundred figures takes under a minute and a whole year for every store (about twelve
thousand) is better loaded through the platform's import than pasted.

Open with the controller, not decided here: whether Gross Margin includes Other Income. The
P&L's order and each line's kind are data, so either answer is a change to rows.

## Names And Their Siblings

| New name | Where | Nearest existing sibling | Rule it follows |
|---|---|---|---|
| Budgets (`budgets`) | The app | Assets (`equipment`), Tickets (`tickets`) | An app is a plain plural noun; its tables are `<app>.<name>` |
| Budget Editor, Budget Viewer | Roles | Assets Manager, Dash Reader, Featherbase Viewer | The owner's own names. Siblings start with the app's name as written ("Budgets ..."); these use the singular, as he said them |
| Monthly Close, Monthly Close Adjustment, Monthly Close Follow-up | Two tables and a ticket type | Verification Count and Count Line (Assets) | One stem for one thing; a child's name starts with its parent's |
| P&L Line, GL Account, GL Account Split, Allocation Rule, Allocation Rule Segment, Allocation Rule Store, Budget Version, P&L Budget, Sales Budget, Budget Store Plan | Tables | Cost Centre, Profit Centre, Business Line Segment | Singular, Title Case, the finance team's own words |
| `plant`, `legal_company`, `operating_region`, `business_line_segment`, `subcategory`, `cost_centre`, `profit_centre` | Link columns | The same column names on Profit Centre, Cost Centre and Site | A link is named after the table it links to |
| `account_code`, `account_name`, `line_key`, `line_name`, `rule_name`, `version_name` | Key and title columns | `asset_name`, `type_name`, `class_name` (Assets) | An app table prefixes its name column with the thing; a code keeps the word "code" |
| `starts_on`, `ends_on`, `planned_opening_on` | Day columns | `starts_on`, `ends_on` (Department, Job Assignment), `opened_on` (Site) | A calendar day ends in `_on` |
| `downloaded_at`, `approved_at`, `published_at` | Instant columns | `approved_at`, `issued_at` (Assets) | An instant ends in `_at` |
| `covers_from`, `covers_to` | A version's months | `freeze_from`, `freeze_to` (Assets), `valid_from` (Cost Centre) | A range is a `_from` and `_to` pair |
| `version_state`, `close_state`, `adjustment_state` | State columns | `count_state`, `exception_state` (Assets), `ticket_state` (Tickets) | An app table's state is `<thing>_state` |
| `budget_month`, `close_month` | Month columns | none | A month is held as its first day and named `_month` |
| `area_sqft`, `rate_per_sqft`, `share_percent` | Measures | none | The unit is in the name |
| FigureMatrix, PasteRows, FoldToggle, `fmtLakhs`, `pastedCells` | Shared components and helpers | DataList, FieldGrid, PathBar, `fmtINR`, `fmtExact` | A component is a PascalCase noun for what it shows; a formatter is `fmt` and its unit |
| P&L, Budgets, Monthly Close, Adjustments, Accounts, P&L Lines, Allocation Rules, Store Areas, Follow-ups | Screens | Repair Jobs, Counts, Transfers (Assets) | Title Case, the plural of what the page lists |
