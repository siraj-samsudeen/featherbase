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
a Table whose data lives in a connected outside database.

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
