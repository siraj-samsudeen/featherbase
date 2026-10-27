# sales-target-report Specification

## Purpose

The sales target report tells each store employee, on one page, how the
subcategories they answer for are doing against target this month: target,
sales so far, the gap and the achievement, with a subtotal for each Section
of the store. Who sees what follows from the store's own rosters, so a Team
Leader, a Department Manager or a Store Manager sees their whole area without
anyone setting it up person by person, and nobody sees another store's figures.
About forty store staff open it daily, so it must load fast, say how current
its figures are, and never show a missing figure as zero.

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

When a reader's scope spans more than one store, the report SHALL show one store at a time and SHALL offer a store dropdown listing each of the reader's stores. The report SHALL open on the remembered store when the reader still has it, otherwise on the default store: the store with the most Sections, a tie going to the lowest store code. The server SHALL serve a requested store only when it is one of the reader's own stores and SHALL refuse any other. A reader with one store SHALL see no dropdown, and a reader with an ambiguous employee code SHALL still have no store at all.

#### Scenario: A Department Manager with Sections in two stores

- **WHEN** a Department Manager whose Sections sit in store 1501 and store 1515 opens the report
- **THEN** they see the report for the store holding more of their Sections, with a dropdown offering both stores

#### Scenario: Switching stores

- **WHEN** that reader picks the other store in the dropdown
- **THEN** the report reloads for that store alone, and opens on it the next time they visit

#### Scenario: A store that is not the reader's

- **WHEN** a request names a store that is not among the reader's own
- **THEN** the server refuses it, starts no live report session and reads no figures

#### Scenario: An administrator assigns a second store

- **WHEN** an administrator saves a Sales Target Assignment row at a second store for a reader
- **THEN** that reader's report offers both stores instead of failing

#### Scenario: A reader with one store

- **WHEN** a reader whose scope is one store opens the report
- **THEN** the report is that store's, with no dropdown

### Requirement: The report lists the reader's stores by name

Asking who the reader is SHALL list every store the reader can open, sorted by store code, each with its name, its Sections and why the reader has it, and SHALL name the default store. A store's name SHALL be its Sales Target Assignment label when one is set, else the name the cached figures give that store, else none. The question SHALL NOT take a store, and the assignment it reports SHALL be the default store's.

#### Scenario: A store with no assignment label

- **WHEN** a reader's store comes only from the Store Sections maps and the cached figures name that store
- **THEN** the store's entry carries that name

#### Scenario: A reader with no store

- **WHEN** a reader with no assignment and no mapped Section asks who they are
- **THEN** their list of stores is empty and they have no default store

### Requirement: The store request is checked on every read

The report and the live report session SHALL each take an optional store. An absent or empty store SHALL mean the default store. A store given more than once, or naming a store that is not among the reader's own, SHALL be refused before any live report session is started or any figure is read, including for a reader who has no store at all.

#### Scenario: An empty store

- **WHEN** a request carries a store with no value
- **THEN** it is served for the reader's default store

#### Scenario: A repeated store

- **WHEN** a request names store 1501 and store 1515 together
- **THEN** the server refuses it

#### Scenario: A reader with no store names one

- **WHEN** a reader whose ambiguous employee code leaves them no store names store 1501
- **THEN** the server refuses it

### Requirement: The Access Log records the store opened

Each report opening SHALL be recorded in the Access Log with the store it was limited to, so that who viewed which store can be answered. The record SHALL also say whether the figures came from the cache or were read live, and which cached copy served them.

#### Scenario: A two-store reader opens their second store

- **WHEN** a reader opens the report for store 1515
- **THEN** the Access Log row for that opening names store 1515

### Requirement: A store that is no longer the reader's falls back with a note

When a read for the store on show is refused, the page SHALL ask who the reader is again. When the reader still has access but that store is no longer among theirs, the page SHALL open the default store, forget the remembered choice, and say that the store is no longer assigned to them. The no-access card SHALL be shown only when the question of who the reader is itself is refused. A store change SHALL be announced to assistive technology.

#### Scenario: An administrator removes a reader's second store

- **WHEN** a reader has store 1515 open and its assignment is removed
- **THEN** the report opens on their default store with a note that 1515 is no longer assigned to them, and no "no access" card

### Requirement: Every listed subcategory is named from the hierarchy

The report SHALL name each subcategory in the reader's list from the merchandise hierarchy, whether or not the subcategory has a target this month. On every surface a reader sees, the report SHALL call it a "subcategory", never a "material group" or a "group".

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

### Requirement: Only people given the report can open it

Only people who hold the report's viewer role SHALL open the report or see anything about their own scope. The role SHALL be checked on every request, so taking it away stops the reader's very next request, and a person without it SHALL be told plainly that they have no access, with no figure and no cached table shown.

#### Scenario: A signed-in person without the role

- **WHEN** a signed-in person who does not hold the viewer role opens the report
- **THEN** they see a plain "no access" message and no figures

#### Scenario: The role is taken away mid-session

- **WHEN** an administrator removes the role from a reader who has the report open, and the reader's page makes its next request
- **THEN** that request is refused and the page shows the "no access" message

### Requirement: A reader with nothing assigned is told so

A reader whose scope holds no subcategory SHALL be told that no subcategories are assigned to them and to ask their manager, and SHALL see no figures.

#### Scenario: An account with no assignment

- **WHEN** a person with the viewer role but no assignment and no mapped Section opens the report
- **THEN** they are told no subcategories are assigned to them, and no figures appear

### Requirement: A shared employee code gives no scope

When the employee code that would give a person their scope is also current on another person, the report SHALL give neither person any scope, and SHALL raise an alert for an administrator, rather than guess whose it is.

#### Scenario: One code on two people

- **WHEN** the same employee code is current on two people, for example in two firms
- **THEN** neither of them sees any subcategory, and an alert is raised

### Requirement: The scope follows the person's current employee codes

A reader's Section-based scope SHALL come from every employee code currently recorded for them, and SHALL ignore a code that has ended. Changing a code SHALL change the next opening, with nothing rebuilt.

#### Scenario: Two current codes

- **WHEN** a person has two current employee codes that each lead different Sections
- **THEN** they see the Sections of both, and each reason once

#### Scenario: A code that has ended

- **WHEN** one of a person's codes has ended and another is current
- **THEN** only the current code's Sections are shown

### Requirement: A roster Section can cover several merchandise Sections

The roster names Sections in its own words, and the report SHALL match them to the store's merchandise Sections regardless of spacing or capital letters, using the store's Section alias list where the roster's Section spans several merchandise Sections. Two leaders rostered on one Section from the same day SHALL both see it, and a roster row with no date SHALL count as in force.

#### Scenario: A roster Section that spans two merchandise Sections

- **WHEN** the roster's "Home Décor & Stationery" is aliased to Home Décor and Stationery at a store, and its Team Leader opens the report
- **THEN** they see the subcategories of both

#### Scenario: Two leaders from the same day

- **WHEN** two Team Leaders are rostered on one Section from the same day
- **THEN** both see that Section

### Requirement: Achievement is the ratio of the sums

A row's, a Section's and the total's achievement SHALL be its sales as a percentage of its target, so a total reflects the amounts rather than an average of the rows' percentages. A target of zero or no target SHALL show no achievement.

#### Scenario: A total across a large and a small subcategory

- **WHEN** one subcategory achieves 50% of a large target and another 200% of a small one
- **THEN** the total's achievement is total sales over total target, not 125%

### Requirement: A missing figure is never read as zero

A subcategory with a target but no sales figure recorded yet SHALL show its sales, gap and achievement as missing, never as ₹0, SHALL be left out of the sums, and SHALL be counted so the reader is told how many have no sales figure. A subcategory that sold nothing is shown with ₹0.

#### Scenario: A target day beyond the latest sales

- **WHEN** a subcategory has a target but the warehouse holds no sales figure for it yet
- **THEN** its sales show as a dash, not ₹0, and the report says how many subcategories have no sales figures

### Requirement: Say how current the figures are

The report SHALL show the date the warehouse's sales run through, and when the figures run only to an earlier day than the month's end, SHALL say they are counted through that day. A report served from the cache SHALL also show when the cache was last refreshed; a report read live SHALL show no refresh time, because nothing can be stale.

#### Scenario: Sales loaded through the 15th

- **WHEN** a reader opens the report on the 17th and the warehouse holds sales through the 15th
- **THEN** the report says "data as of" the 15th and that figures are counted through that day

#### Scenario: A cached report

- **WHEN** a reader opens a report served from the cache
- **THEN** it shows when the cache was refreshed as well as the warehouse's date

### Requirement: A reader is never left waiting for the cache

When no cached copy of the figures exists yet, the report SHALL be read live from the warehouse and shown at once, and the request SHALL cause a cached copy to be built soon, so the next readers get a quick answer. A burst of such requests SHALL cause one build, not one per reader.

#### Scenario: The first reader of the day

- **WHEN** a reader opens the report and no cached copy exists
- **THEN** they see correct live figures, and a build of the cache is scheduled

#### Scenario: Several readers at once

- **WHEN** many readers open the report together before the cache exists
- **THEN** one build is scheduled, not one per reader

### Requirement: The cache is shared but each reader sees only their own

All readers SHALL be served from one cached copy of the store's figures, and each reader's slice SHALL be cut from it at the moment they read it. A change to a person's assignment or role SHALL therefore apply to their next read without waiting for any refresh.

#### Scenario: A changed assignment

- **WHEN** an administrator moves a subcategory from one employee to another
- **THEN** the next time each opens the report, the first no longer has it and the second does, with no refresh in between

#### Scenario: Two stores, one cache

- **WHEN** a reader at one store and a reader at another open the report from the same cached copy
- **THEN** each sees only their own store's figures

### Requirement: A failed refresh keeps the last good figures

When a refresh fails, finds nothing, or loses most of the figures, the report SHALL keep serving the last good cached copy and the refresh SHALL show as failed to the people who run the instance. A cached copy built for last month SHALL NOT serve this month's report.

#### Scenario: The warehouse is unreachable

- **WHEN** a scheduled refresh cannot reach the warehouse
- **THEN** readers keep seeing the previous figures and the refresh run is recorded as failed

#### Scenario: The first of a new month

- **WHEN** a reader opens the report on the 1st, India time, and the only cached copy was built last month
- **THEN** the report is read live for the new month and a build is scheduled

### Requirement: Operators can see how each refresh went

A System Manager SHALL be able to see each cached copy and each request that found none, with how long the refresh took, what set it off and why a refused one was refused. The cached figures themselves SHALL NOT be readable through the general data screens.

#### Scenario: A refused refresh

- **WHEN** a refresh is refused because it found no targets
- **THEN** a System Manager can see that refresh, its reason and its timings

#### Scenario: Another person's view

- **WHEN** a report viewer tries to read the record of cached copies or of who opened the report
- **THEN** they are refused

### Requirement: The live report fails honestly

When the live report session cannot be started because the instance has no live report set up, the page SHALL quietly show the cached table as the report, with no error. When it is set up but unreachable or refuses, the page SHALL say the report session could not be created and that this is not a sales figure. The live report's credentials SHALL never be sent to the browser.

#### Scenario: No live report on this instance

- **WHEN** the instance has no live report set up
- **THEN** the cached table is the report, shown open, with no error

#### Scenario: The live report service is down

- **WHEN** the live report service cannot be reached
- **THEN** the page says the report is unavailable and that this is not a sales figure

### Requirement: The reader is shown by name, never by id

The report's header SHALL show the reader by full name, else username, else email, never by an internal id, and SHALL tell the reader that figures are before tax and net of returns.

#### Scenario: A person with no full name

- **WHEN** a reader with no full name opens the report
- **THEN** the header shows their email, not an internal id

### Requirement: Administrators assign subcategories one owner at a time

An administrator SHALL be able to assign a subcategory of a store to one employee, and SHALL be refused a second owner for the same store and subcategory. Store codes SHALL be exactly four digits and subcategory codes exactly nine. Moving a subcategory to another employee SHALL change the next opening of both, and nobody else's.

#### Scenario: A second owner

- **WHEN** an administrator assigns a store's subcategory that already belongs to another employee
- **THEN** the save is refused

#### Scenario: A malformed code

- **WHEN** an administrator saves a three-digit store code
- **THEN** the save is refused with a plain reason

#### Scenario: A transfer

- **WHEN** an administrator moves a subcategory from one employee to another
- **THEN** the next time each opens the report the first no longer has it and the second does

### Requirement: A badly entered subcategory code is left out, not guessed

A subcategory code in the store's maps that is not exactly nine digits SHALL be left out of the reader's report and logged, and SHALL NOT reach any query. The rest of the reader's subcategories SHALL still show.

#### Scenario: A mistyped code in the merchandise map

- **WHEN** a Section's merchandise map holds a code that is not nine digits
- **THEN** that code is left out and the reader's other subcategories in the Section still show

### Requirement: A badly entered store code is refused in plain words

When the maps give a reader a store code that is not exactly four digits, the report SHALL stop for that reader with a plain message asking them to tell their administrator, and SHALL NOT read any figure for it.

#### Scenario: A mistyped store code

- **WHEN** a reader's map names a store with a three-digit code
- **THEN** the reader is told their account maps to a store code that is not four digits and to ask an administrator to correct it
