# sales-target-report Specification

## Purpose
TBD - created by archiving change sales-target-section-scope. Update Purpose after archive.

## Requirements

### Requirement: Team Leaders see the Sections they lead

A Section is an area of a store's floor, such as Kurti or Home Décor, that holds a set of subcategories. A Team Leader SHALL see every subcategory of every Section that the store's staff roster names them as leading.

#### Scenario: Team Leader opens the report

- **WHEN** a Team Leader whose Section holds ninety subcategories opens the report
- **THEN** all ninety subcategories are shown, not only the few rostered to them personally

### Requirement: Department Managers see the Sections they manage

A Department Manager SHALL see every subcategory of every Section that the roster names them as managing.

#### Scenario: Department Manager opens the report

- **WHEN** a Department Manager who manages six Sections opens the report
- **THEN** the subcategories of all six Sections are shown

### Requirement: Personal subcategories still count

A reader SHALL also see the subcategories rostered to them personally and any assigned to them directly, in addition to the Sections they lead or manage.

#### Scenario: Leader also rostered on another subcategory

- **WHEN** a Team Leader is also rostered on a subcategory outside their Section
- **THEN** that subcategory is shown along with their Section

### Requirement: The roster is read as of today, Section by Section

Who leads or manages a Section SHALL be decided by that Section's most recent roster entry dated on or before today, so a handover changes only the Section handed over.

#### Scenario: A Section changes hands

- **WHEN** one Section gets a new Team Leader from a given day
- **THEN** from that day the new Team Leader sees it and the previous one does not, while every other Section keeps its leader

### Requirement: Month to date in India time

The report SHALL cover the current month from the first through today in India Standard Time, and SHALL move to the new month at midnight India time.

#### Scenario: First day of the month

- **WHEN** a reader opens the report just after midnight on the 1st, India time
- **THEN** the report covers the new month, never the previous one

### Requirement: Say when the month has no data yet

When the warehouse has not yet recorded any day of the current month, the report SHALL say so instead of showing empty figures.

#### Scenario: Early on the 1st

- **WHEN** a reader opens the report on the 1st before that morning's sales have loaded
- **THEN** they are told no sales are recorded for the month yet, and nothing reads as zero sales

### Requirement: Subtotals by Section

The report SHALL group subcategories under their Section with a subtotal for each, and SHALL show subcategories that belong to no Section after the named ones.

#### Scenario: Reader with two Sections

- **WHEN** a reader who leads Home Décor and Stationery opens the report
- **THEN** each Section has its own subtotal, and together they add up to the report total

### Requirement: Say why the reader sees these figures

The report SHALL tell the reader every reason they see it, such as leading a Section or being rostered on a subcategory.

#### Scenario: Leader who is also rostered on subcategories

- **WHEN** a Team Leader who is also rostered on some subcategories opens the report
- **THEN** the report gives both reasons

### Requirement: One report on the page

When the live report is available, it SHALL be the report the reader sees. The cached table SHALL be folded away behind a line that says it is the cache and when it was refreshed, and SHALL be shown open only when the live report is not there.

#### Scenario: Live report available

- **WHEN** a reader opens the report and the live report loads
- **THEN** they see one set of figures, and the cached table is folded away under a line giving its refresh time

### Requirement: A Store Manager sees the whole store

When the store's Store Manager row names a reader's employee code, the report
SHALL show that reader every subcategory the store's merchandise map holds,
grouped by Section with a subtotal per Section, and SHALL say they see it as
Store Manager. A Store Manager's scope SHALL stop at their own store. An
instance without the Store Manager Table SHALL behave as before.

#### Scenario: The ATK Store Manager opens the report

- **WHEN** the Store Manager of Attakulangara signs in and opens the report
- **THEN** they see every Section of Attakulangara, each with its subtotal, and the reason "Store Manager"

#### Scenario: Another store's manager

- **WHEN** the Store Manager of Kattakada opens the report
- **THEN** they see Kattakada's subcategories only

#### Scenario: No Store Manager Table

- **WHEN** the instance has no Store Manager Table
- **THEN** nobody is given a store-wide scope by it

### Requirement: Many Sections are counted, not listed

The report's heading SHALL name a reader's Sections when there are three or
fewer. With more than three it SHALL show their number instead — "Whole store ·
N Sections" for a Store Manager, "N Sections" for anyone else — and the full
list SHALL be reachable by a tap or a key press, not only by hovering.

#### Scenario: A Team Leader with one Section

- **WHEN** a Team Leader whose scope is one Section opens the report
- **THEN** the heading names that Section and offers nothing to expand

#### Scenario: A Store Manager with 57 Sections

- **WHEN** the Store Manager of Attakulangara opens the report
- **THEN** the heading reads "Whole store · 57 Sections", and tapping it lists all 57

#### Scenario: A Department Manager with five Sections

- **WHEN** a Department Manager whose scope is five Sections opens the report
- **THEN** the heading reads "5 Sections", and tapping it lists them

### Requirement: A reader with several stores switches between them

When a reader's scope spans more than one store, the report SHALL show one store at a time and SHALL offer a store dropdown listing each of the reader's stores. The report SHALL open on the remembered store when the reader still has it, otherwise on the default store: the store with the most Sections, a tie going to the lowest store code. The server SHALL serve a requested store only when it is one of the reader's own stores and SHALL refuse any other with 403. A reader with one store SHALL see no dropdown, and a reader with an ambiguous employee code SHALL still have no store at all.

#### Scenario: A Department Manager with Sections in two stores

- **WHEN** a Department Manager whose Sections sit in store 1501 and store 1515 opens the report
- **THEN** they see the report for the store holding more of their Sections, with a dropdown offering both stores

#### Scenario: Switching stores

- **WHEN** that reader picks the other store in the dropdown
- **THEN** the report reloads for that store alone, and opens on it the next time they visit

#### Scenario: A store that is not the reader's

- **WHEN** a request names a store that is not among the reader's own
- **THEN** the server answers 403 and mints no embed session and reads no figures

#### Scenario: An administrator assigns a second store

- **WHEN** an administrator saves a Sales Target Assignment row at a second store for a reader
- **THEN** that reader's report offers both stores instead of failing

#### Scenario: A reader with one store

- **WHEN** a reader whose scope is one store opens the report
- **THEN** the report is that store's, with no dropdown

### Requirement: The identity call lists the reader's stores

`GET /api/sales_target/me` SHALL return `stores`, one entry per store the reader can open, sorted by store code, each with `plant_code`, `store_name`, `sections` and `scope_basis`, and `default_store`, the code of the default store (null when the reader has none). Its `assignment` SHALL be the default store's. It SHALL take no store parameter. A store's `store_name` SHALL be its Sales Target Assignment label when one is set, else the active snapshot's name for that store, else null.

#### Scenario: A store with no assignment label

- **WHEN** a reader's store comes only from the Store Sections maps and the active snapshot names that store
- **THEN** the store's entry carries the snapshot's store name

#### Scenario: A reader with no store

- **WHEN** a reader with no assignment and no mapped Section asks who they are
- **THEN** `stores` is empty and `default_store` is null

### Requirement: The store parameter is checked on every read

`/report` and `/embed_session` SHALL take an optional `store` query parameter. An absent or empty parameter SHALL mean the default store. A parameter given more than once, or naming a store that is not among the reader's own, SHALL be refused with 403 before any embed session is minted or any figure is read, including for a reader who has no store at all.

#### Scenario: An empty store parameter

- **WHEN** a request carries `store=` with no value
- **THEN** it is served for the reader's default store

#### Scenario: A repeated store parameter

- **WHEN** a request carries `store=1501&store=1515`
- **THEN** the server answers 403

#### Scenario: A reader with no store names one

- **WHEN** a reader whose ambiguous employee code leaves them no store names store 1501
- **THEN** the server answers 403

### Requirement: The Access Log records the store opened

Each report opening SHALL be recorded in the Access Log with the store it was limited to, as `store=<code>` in the row's `scope`, so that who viewed which store can be answered.

#### Scenario: A two-store reader opens their second store

- **WHEN** a reader opens the report for store 1515
- **THEN** the Access Log row for that opening has scope `store=1515`

### Requirement: A store that is no longer the reader's falls back with a note

When a read for the store on show is refused with 403, the page SHALL ask the identity call again. When the reader still has access but that store is no longer among theirs, the page SHALL open the default store, forget the remembered choice, and say that the store is no longer assigned to them. The no-access card SHALL be shown only when the identity call itself refuses. A store change SHALL be announced to assistive technology.

#### Scenario: An administrator removes a reader's second store

- **WHEN** a reader has store 1515 open and its assignment is removed
- **THEN** the report opens on their default store with a note that 1515 is no longer assigned to them, and no "no access" card

### Requirement: Every listed subcategory is named from the hierarchy

The report SHALL name each subcategory in the reader's list from the merchandise hierarchy, whether or not the subcategory has a target this month. On every surface a reader sees, the report SHALL call it a "subcategory", never a "material group" or a "group"; `material_group` is the internal SAP code (MATKL) behind it.

#### Scenario: A subcategory with no target this month

- **WHEN** a reader's Section lists a subcategory that is in the merchandise hierarchy and has no target this month
- **THEN** the subcategory shows its hierarchy name, never "(name not in hierarchy)"

#### Scenario: A code the hierarchy does not hold

- **WHEN** a reader's list carries a code that is not in the merchandise hierarchy
- **THEN** that code reads "(name not in hierarchy)"

### Requirement: Every sale counts, target or not

The report SHALL show each subcategory's sales for the store and the month to date from all sales, and SHALL read a ₹0 target where none was set. A subcategory that has a target SHALL show the same actual as the target rows carry. Sales whose material group code is empty SHALL be left out, as the target mart leaves them out.

#### Scenario: A subcategory that sold with no target

- **WHEN** a subcategory with no target sold ₹1,200 this month at the reader's store
- **THEN** the subcategory shows ₹0 target and ₹1,200 actual, and its Section subtotal includes the ₹1,200

### Requirement: Subcategories with no target and no sale are hidden by default

A subcategory with ₹0 target and ₹0 sales this month SHALL be hidden by default. The report SHALL offer a "Show subcategories with no target or sales" toggle that names how many there are and shows them when turned on. Each Section subtotal and the report total SHALL be the sum of the Section's rows, hidden or shown.

#### Scenario: A Food Court Section that lists every Food Court subcategory

- **WHEN** a reader's Section lists 120 subcategories and the store traded 20 of them this month
- **THEN** the 20 are shown, the other 100 are hidden behind the toggle, and the Section subtotal is the same with the toggle on or off

### Requirement: A missing target side is never read as ₹0 targets

When the warehouse holds no material-group target for the month, the report SHALL NOT show ₹0 targets. A cached copy SHALL NOT be refreshed from it, and the last good copy SHALL keep serving; a cached copy SHALL also not be refreshed when it would lose more than half of its target rows. A live read SHALL show sales with the targets left blank and say that targets are not available.

#### Scenario: The target side comes back empty

- **WHEN** a refresh finds sales for the month but no targets
- **THEN** the refresh is refused and readers keep the last good figures

#### Scenario: A live read with no targets

- **WHEN** a reader opens the report live and the month has no targets
- **THEN** sales are shown, every target is blank, nothing is hidden, and the page says targets are not available
