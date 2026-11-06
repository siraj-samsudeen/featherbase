# Search and Explore

## Purpose

Beyond opening a matching Table, record or command from the search bar, the
user can also follow a row's relationships two other ways: Explore chains
tables together and narrows them by clicking, and the relationship map shows
one row's neighborhood as a walkable diagram. The search bar's matching of
Tables, new-row actions, commands and records is specified in Admin UI
Feedback; this capability covers what that one doesn't.

## Requirements

### Requirement: Search only reaches what the user can read

Searching SHALL only match rows the user can open, including any limit to
rows they created or to a chosen set of rows. It SHALL never match rows from
a Table whose data lives in a connected outside database, nor from a Table
of an app that is turned off, awaiting activation of an upgrade, or upgraded
since the user's page loaded. Such an app SHALL NOT stop search from
answering with matches from every other Table.

#### Scenario: Search stays within the user's own rows

- **WHEN** a search matches both a customer the user created and a customer
  someone else created, and the user is limited to their own rows
- **THEN** only the customer the user created appears

#### Scenario: Search stays within the user's region

- **WHEN** a search matches customers inside and outside the one region the
  user is allowed to access
- **THEN** only customers in the user's region appear

#### Scenario: A connected table is invisible to search

- **WHEN** the user searches for a value that only exists in a row of a
  Table connected to an outside database
- **THEN** no result for that row appears, even though the Table itself can
  still be opened

#### Scenario: A turned-off app does not break search

- **WHEN** an installed app is turned off and someone searches for a value
  found both in one of that app's Tables and in an ordinary Table
- **THEN** the ordinary Table's row appears and the app's row does not
- **AND** once the app is turned back on, its row appears again

#### Scenario: An app upgraded while the page was open

- **WHEN** an app with its own data changes is upgraded while the user's page
  is open, and the user searches before reloading
- **THEN** matches from every other Table appear, and the app's rows appear
  again once the page is reloaded

### Requirement: Search shows a handful of best matches, not everything

Search SHALL cap how many matches it shows per Table and overall, favoring a
fast typeahead over a complete list.

#### Scenario: Many matches

- **WHEN** a search term matches far more rows than fit in the dropdown
- **THEN** only the first few per Table are shown, up to an overall cap

#### Scenario: Many Tables

- **WHEN** a search term matches several rows in each of many Tables
- **THEN** the results stop at the overall cap even though every Table has more matches

### Requirement: The search bar remembers what the user did

Focusing the empty search bar SHALL offer the user's own recently visited
destinations and, among those visited more than once, the most frequently
used ones; typing SHALL also offer matching past searches to rerun. This
history is private to the user and follows them across devices.

#### Scenario: Reopen a recent destination

- **WHEN** the user focuses the empty search bar
- **THEN** their most recently visited rows, lists and pages appear, ready to
  reopen with one click

#### Scenario: A past search reappears while typing

- **WHEN** the user starts typing something they searched before
- **THEN** that past search is offered so they can rerun it

### Requirement: Navigation history follows the current instance

The user's recent and frequent destinations SHALL follow the instance's saved history on each app load and sign-in, replacing the browser's remembered history even when the instance has none. Visits not yet included in that history MUST remain available.

A saved visit MUST count only once even when the browser's clock differs from the instance's clock. A delivery acknowledgement alone MUST NOT discard a visit missing from an earlier history snapshot.

#### Scenario: Old destinations disappear after history is cleared

```gherkin
Given the user has remembered visits to the Person destination
And the instance has forgotten the user's visits
When the user reloads the app
Then the user's navigation history has no Person destination
```

#### Scenario: Current history replaces old remembered destinations

```gherkin
Given the browser remembers an old destination absent from the instance history
And the instance remembers the user's Person destination
When the user reloads the app
Then the user's navigation history contains Person but not the old destination
```

#### Scenario: A new visit survives a history refresh

```gherkin
Given the user's history is loading
When the user opens the Person destination before history finishes loading
Then the Person destination remains in the user's navigation history
```

### Requirement: Unconfirmed cached history stays hidden

The user's cached navigation history MUST remain hidden until the initial history request finishes. If that request fails, the user SHALL be offered the remembered history as a best-effort fallback.

#### Scenario: Old destinations never flash while history loads

```gherkin
Given the browser remembers an old destination absent from the instance history
When the user's history is still loading
Then neither navigation surface offers the old destination
```

#### Scenario: Remembered destinations remain usable when history fails

```gherkin
Given the user has remembered visits to the Person destination
When the initial history request fails
Then both navigation surfaces offer the Person destination
```

### Requirement: Explore chains tables and narrows them as you click

Explore SHALL let the user start from a Table and add up to two more, each
connected to the one before by a reference or a child relationship. Clicking
rows in one selects them, narrowing every table after it to what relates to
that selection, with an exact count and sum; with nothing selected, a table
follows everything related to what's above it. Opening a row from Explore
SHALL open it in the same peek panel a form's own links open, rather than
leaving Explore.

#### Scenario: Narrow by clicking

- **WHEN** the user starts Explore from Supplier, adds Purchase Order, clicks
  one supplier, then adds PO Line
- **THEN** Purchase Order narrows to that supplier's orders, and PO Line
  narrows to those orders' lines, with an accurate count and sum at every
  stage

#### Scenario: Open a row without leaving Explore

- **WHEN** the user opens one of the rows Explore is showing
- **THEN** it opens in the same peek panel a form's linked rows open in, and
  closing it returns to Explore unchanged

### Requirement: An Explore chain can be shared and reopened

An Explore chain and its selections SHALL be shareable as a link that
reopens the same view, degrading to whatever part of it still resolves if
something it names has since been removed.

#### Scenario: A dropped column

- **WHEN** a shared Explore link names a column that has since been removed
- **THEN** Explore opens as far as it still can, rather than showing a blank
  page

### Requirement: The relationship map shows one row's neighborhood

Opening a row's relationship map SHALL show what it points to and what
points back to it, with a count for each, and let the user open a related
collection or jump to a related row to re-center the map there.

#### Scenario: Jump to a related row

- **WHEN** the user opens an order's relationship map and clicks its
  customer
- **THEN** the map re-centers on that customer, showing what it in turn
  points to and back from

### Requirement: The relationship map remembers the trail

Hopping between rows on the relationship map SHALL keep a trail of where the
user came from, letting them jump back to any earlier stop.

#### Scenario: Back up the trail

- **WHEN** the user has hopped from an order to its customer to one of the
  customer's other orders
- **THEN** they can jump back to the original order in one click

### Requirement: Search only uses information the user can read

Search SHALL neither match nor display a sensitive value the user is not
allowed to read. A row that matches by its ID SHALL remain available, using
that ID in place of its sensitive title.

#### Scenario: A secret title alone does not produce a match

- **WHEN** a user searches for text found only in a sensitive title they are
  not allowed to read
- **THEN** that row does not appear

#### Scenario: A visible row keeps its secret title hidden

- **WHEN** a user searches for the ID of a row they can open, but its title is
  sensitive to them
- **THEN** the row appears using its ID, without the sensitive title

#### Scenario: Deeper access includes the title

- **WHEN** a user with access to the sensitive title searches for text in it
- **THEN** the matching row appears with that title

### Requirement: A row shared with the user opens by link but is not searched

A row that someone shared directly with the user SHALL open from its link, but SHALL NOT appear in the user's search results unless their own access to the Table already includes it.

#### Scenario: A shared customer

- **WHEN** a colleague shares one of their own customers with the user, who can otherwise see only their own customers
- **THEN** the shared customer opens from the link, and a search for its name finds nothing

### Requirement: Structural records rank last and say what they are

Search results that are the platform's own definitions, such as a Table's definition or a permission rule, SHALL be listed after ordinary records and SHALL say what kind of definition they are, so they are not mistaken for the Table or for business data.

#### Scenario: A Table's definition

- **WHEN** the user searches for a word that matches both a customer record and the definition of a Table with that word in its name
- **THEN** the customer is listed first, and the definition is labelled as a Table definition

### Requirement: Recent visits do not crowd out frequent destinations

The user's navigation SHALL offer frequently used destinations alongside
recent ones when there are frequent destinations not already shown.

#### Scenario: Many recent visits

- **WHEN** the user visits several new destinations after repeatedly using
  an older destination
- **THEN** the older destination remains available among frequently used
  destinations without repeating one already shown as recent

### Requirement: Open the last related row in place

Selecting a row at the end of an Explore chain SHALL open its details in
place without changing the selections that narrowed the chain.

#### Scenario: Inspect the last pane

- **WHEN** the user follows a supplier to its orders and then their items,
  and selects one of the items
- **THEN** the item's details open without leaving Explore
- **AND** closing the details leaves the supplier and order selections intact

### Requirement: Find the starting table by typing

In Explore, the user SHALL be able to type words from a table's name, in any
case, to narrow the tables to start from to those whose name holds every
word, and press Enter to start from the first match.

#### Scenario: Explore opens on the purchases

```gherkin
Given the user is a System Manager
And a table of suppliers and a table of purchases, each purchase from a supplier
When the user types "purch" in Explore's table search and presses Enter
Then Explore starts from the purchases
```

### Requirement: Explore shows a linked row by its title

A row in Explore SHALL show each row it links to by that row's title (the
value that names it, such as a supplier's name) rather than its id, wherever
the user may read that title.

#### Scenario: Each purchase shows its supplier "Acme"

```gherkin
Given the user is a System Manager
And a table of suppliers and a table of purchases, each purchase from a supplier
And the purchases are from the supplier "Acme"
When the user types "purch" in Explore's table search and presses Enter
Then each purchase shows "Acme (sup-1)"
```

### Requirement: The relationship map says how each row is related

Each linked row and related collection on the relationship map SHALL say
which Table it comes from and, in full and in the words the user knows the
link by, which link joins it to the row at the center, never a technical
name.

#### Scenario: A chore's assignee reads "Assigned To"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map
Then the user sees "Asha", a Volunteer, linked by "Assigned To"
```

#### Scenario: Asha's chores read by "Assigned To"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens Asha's relationship map
Then the user sees Asha's chores related by "Assigned To"
```

### Requirement: The relationship map lists its center row until a collection is opened

Until the user opens a related collection, the relationship map SHALL list
the row at its center the way it lists an opened collection's rows, so that
row's own values are in view too.

#### Scenario: Asha is listed with her phone until her chores are opened

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens Asha's relationship map
Then the user sees "Asha" listed with her phone "555-0142"
When the user opens Asha's chores
Then the user sees "Paint the fence" listed instead of "Asha"
```

### Requirement: A link in the relationship map's row lists reads by its title

In the rows the relationship map lists, a cell that links to another row SHALL
show that row's title, not its id, wherever the user may read it, and
clicking it SHALL move the map to that row.

#### Scenario: Paint the fence's assignee reads "Asha"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map
Then the user sees "Paint the fence" listed as assigned to "Asha"
```

#### Scenario: Clicking Asha moves the map to her

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map and clicks "Asha" in the listed row
Then the user sees the map centered on "Asha"
```

### Requirement: Recent and frequent destinations offer only rows that still exist

The sidebar's recently opened and frequent destinations, and the command
bar's recent and frequent groups, SHALL offer only remembered rows that still
exist and that the user can read. The user's history SHALL be kept; a
destination left out frees its place for the next one remembered.

#### Scenario: A deleted row is no longer offered

- **WHEN** the user opened the rows "Kept bin" and "Deleted bin", and
  "Deleted bin" was then deleted
- **THEN** the sidebar and the command bar offer "Kept bin" and not
  "Deleted bin"

#### Scenario: A row deleted from its form leaves at once

- **WHEN** the user opens "Deleted bin" and deletes it from its form
- **THEN** the sidebar stops offering it without a reload, and still offers
  "Kept bin"
