# Dashboards and Home Pages

## Purpose

A dashboard is a saved page of number cards and charts computed from live
data. A home page is a saved page of grouped links people land on. Both are
built the same way as any other Table's rows, and both only ever show what
the viewer could otherwise see.

## Requirements

### Requirement: A dashboard's numbers and charts stay live

Opening a dashboard SHALL compute each card's count and each chart's values
fresh from current data, scoped to what the viewer could otherwise read.

#### Scenario: A restricted viewer's card

- **WHEN** a dashboard has a card counting all Orders, and a viewer can only
  read their own
- **THEN** that viewer's card counts only their own orders, not everyone's

### Requirement: A chart can follow a Table or a saved report

A dashboard's chart SHALL show either grouped counts from a Table's rows, or
the current values of a saved report, and a report-driven chart keeps
following that report's own filters and grouping as they change.

#### Scenario: A pinned report chart updates

- **WHEN** a chart pinned from "Open orders by status" is on a dashboard and
  someone later adds an order
- **THEN** the chart shows the new order the next time the dashboard loads

### Requirement: A home page groups links into cards

A home page SHALL show its links grouped into headed cards in the order
they were curated, and hide any link to a Table the viewer can't read rather
than showing it disabled. Links curated before the first named card still
sit under a heading.

#### Scenario: A hidden link

- **WHEN** a home page has a card with a link to a Table one viewer can't
  read
- **THEN** that viewer sees the card's other links but not that one

#### Scenario: Links before the first named card

- **WHEN** a Table is added to a home page that has no named cards
- **THEN** its link appears under a heading, not in a card with no title

### Requirement: A home page can be limited to certain roles

A home page SHALL be visible to everyone unless it names specific roles, in
which case only people holding one of those roles see it. An Administrator
always sees every page.

#### Scenario: A role-restricted page

- **WHEN** a home page is limited to the "Warehouse" role
- **THEN** only people with that role see it in navigation, and everyone
  else does not

### Requirement: A new Table is never lost from navigation

Building a new Table SHALL give it a link on its module's home page
automatically, creating that page first if it doesn't exist yet.

#### Scenario: A table in a new module

- **WHEN** the user builds a Table in a module with no home page yet
- **THEN** a home page for that module appears with a link to the new Table

### Requirement: Resume where you left off

The home page SHALL offer one-click tiles back to the user's last opened
row, last opened list, and last search.

#### Scenario: Tiles back to what the user was just doing

- **WHEN** the user opened a row, then a list, then ran a search, and later
  returns to the home page
- **THEN** they find a tile back to each of the three, ready to reopen with
  one click

### Requirement: Pin a routine as shortcuts

Once the user has kept returning to the same couple of destinations across
several separate days, the home page SHALL offer to pin them together, and
pinning replaces that offer with shortcuts to those destinations that stay
until the user unpins them.

#### Scenario: A routine gets offered as a pin

- **WHEN** the user has kept opening the same two destinations on several
  different days
- **THEN** the home page offers to pin them, and pinning turns the offer
  into shortcuts that stay on the home page until the user unpins them

### Requirement: A private trail of the user's own activity

The home page SHALL show the user a running trail of what they themselves
have opened and searched, visible to no one but them.

#### Scenario: Only the user sees their own trail

- **WHEN** the user opens a row and later runs a search
- **THEN** both show up in their own activity trail, and nobody else can see
  it

### Requirement: A team view shows changes, not views

A System Manager SHALL be able to switch the activity trail to a team view,
which shows everyone's changes and sign-ins but never what a colleague
merely looked at. Each row SHALL name the person and show their main role
(System Manager if they hold it, otherwise another role they hold; nothing
for someone with no role), and SHALL NOT show an opaque id or an email address.

#### Scenario: The team view stays to changes, not views

- **WHEN** a System Manager switches to the team view
- **THEN** they see who changed what and who signed in, but not what anyone
  merely looked at

#### Scenario: Rows name the person and their role

- **WHEN** a System Manager opens the team view and a colleague with the
  System Manager role has made a change
- **THEN** the row shows that colleague's name followed by "System Manager"

#### Scenario: A person with no name still reads as a person

- **WHEN** a colleague has no full name on record
- **THEN** the row shows the part of their email before the "@", never the
  whole address or an internal id

### Requirement: Remembered places read as names

Wherever the home page or the sidebar points back to something the user
opened, it SHALL show that thing's name: a page by its title, and a row by its
title with its Table beneath. A row whose Table names no title column SHALL
read as a few of its own values instead, never as an internal id.

#### Scenario: A page remembered before page titles existed

- **WHEN** the user opened the Explore page before page titles were
  recorded, and later returns to the home page
- **THEN** the tile back to it shows the page's title, not its address

#### Scenario: A row whose Table has no title column

- **WHEN** the user opened a store's row in a merchandise map whose Table has
  no title column
- **THEN** the tile reads as the store code and the subcategory name, with the
  Table's name beneath, not as the row's internal id

### Requirement: The activity trail reads by day, one sentence per row

The activity trail SHALL group rows under the day they happened, naming the
two most recent days today and yesterday and the rest by weekday and date.
Each row SHALL read as one sentence that starts with who acted (the user
themselves in their own trail), says what kind of thing was acted on, and
shows the time.

#### Scenario: The user's own trail

- **WHEN** the user opened a page earlier today
- **THEN** their trail shows it under today, as "You opened" and the page's
  title, with the time it happened

### Requirement: A repeated action shows once

When the same person does the same thing to the same target several times
in a row, the activity trail SHALL show it once, with how many times and the
latest time. The same action separated by something else stays separate.

#### Scenario: Opening the same page twice in a row

- **WHEN** the user opens the same page twice in a row
- **THEN** their trail shows one row for it, marked as two times
