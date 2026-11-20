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

### Requirement: Month to date in India time

The report SHALL cover the current month from the first through today in India Standard Time, and SHALL move to the new month at midnight India time.

#### Scenario: First day of the month

- **WHEN** a reader opens the report just after midnight on the 1st, India time
- **THEN** the report covers the new month, never the previous one

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

When a reader's scope spans more than one store, the report SHALL show one store at a time and SHALL offer a store dropdown listing each of the reader's stores.

#### Normative details for the whole requirement

The report SHALL open on the remembered store when the reader still has it, otherwise on the default store: the store with the most Sections, a tie going to the lowest store code. The server SHALL serve a requested store only when it is one of the reader's own stores and SHALL refuse any other. A reader with one store SHALL see no dropdown, and a reader with an ambiguous employee code SHALL still have no store at all.

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

Asking who the reader is SHALL list every store the reader can open, sorted by store code, each with its name, its Sections and why the reader has it, and SHALL name the default store. A store's name SHALL be its Sales Target Assignment label when one is set, else the store's own name, else none. The question SHALL NOT take a store, and the assignment it reports SHALL be the default store's.

#### Scenario: A store with no assignment label

- **WHEN** a reader's store comes only from the Store Sections maps
- **THEN** the store's entry carries the store's own name

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

Each report opening SHALL be recorded in the Access Log with the stores it was limited to, so that who viewed which store can be answered.

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

### Requirement: Only people given the report can open it

Only people who hold the report's viewer role SHALL open the report or see anything about their own scope. The role SHALL be checked on every request, so taking it away stops the reader's very next request, and a person without it SHALL be told plainly that they have no access, with no figure shown.

#### Scenario: A signed-in person without the role

- **WHEN** a signed-in person who does not hold the viewer role opens the report
- **THEN** they see a plain "no access" message and no figures

#### Scenario: The role is taken away mid-session

- **WHEN** an administrator removes the role from a reader who has the report open, and the reader's page makes its next request
- **THEN** that request is refused and the page shows the "no access" message

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

### Requirement: The live report fails honestly

When the live report can't be opened, because the instance has no live report set up or the live report service is unreachable or refuses, the page SHALL say in one plain sentence that the report couldn't load and offer to try again, without technical detail. The live report's credentials SHALL never be sent to the browser.

#### Scenario: No live report on this instance

- **WHEN** the instance has no live report set up
- **THEN** the page says the report couldn't load, and shows no figures of its own

#### Scenario: The live report service is down

- **WHEN** the live report service cannot be reached
- **THEN** the page says the report couldn't load right now, and trying again reopens the report without reloading the page

### Requirement: The reader is shown by name, never by id

The report's header SHALL show the reader by full name, else username, else email, never by an internal id, and SHALL tell the reader that figures are before tax and net of returns.

#### Scenario: A person with no full name

- **WHEN** a reader with no full name opens the report
- **THEN** the header shows their email, not an internal id

### Requirement: The interactive report is the latest saved Dive

The page SHALL open the latest saved version of the instance's Dive, without naming a version, so saving a new version of the Dive is what releases it to readers. No instance setting SHALL pin a Dive version.

#### Scenario: A new Dive version is saved

- **WHEN** the Dive's owner saves a new version of the Dive on MotherDuck
- **THEN** the next reader who opens the report sees that version, with no change to the app or its settings

### Requirement: Choose this month or last month

The report SHALL let the reader choose this month, from the first through today in India Standard Time, or last month, from its first day through its last. This month SHALL be the default. The choice SHALL be kept in the page's address, and SHALL keep meaning "this month" or "last month" as the calendar moves on. No earlier month SHALL be offered.

#### Scenario: Last month's result early in the next month

- **WHEN** a reader opens the report on 2 November and chooses last month
- **THEN** they see October's targets and sales for 1 to 31 October, limited to their own subcategories as this month's are

#### Scenario: Last month in the interactive report

- **WHEN** a reader chooses last month and the interactive report is set up
- **THEN** the interactive report opens on last month's dates, ending on its last day
