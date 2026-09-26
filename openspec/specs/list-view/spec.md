# List View

## Purpose

Every Table gets a list of its rows in the Admin UI automatically — the same
list works for every Table, driven only by its columns. It's where the user
browses, narrows, and acts on rows without anyone building a screen for it.

## Requirements

### Requirement: Browse a table's rows

A Table's list SHALL show its rows a page at a time, with the total row
count, and opening a row SHALL take the user to its full form.

#### Scenario: Turn the page

- **WHEN** a table holds more rows than fit on one page and the user goes to
  the next page
- **THEN** the next set of rows appears, and the total count still shows how
  many rows the whole table has

### Requirement: Sort by any column

Clicking a column's heading SHALL sort the list by that column, and clicking
the same heading again SHALL reverse the order.

#### Scenario: Reverse the sort

- **WHEN** the user clicks "Due" to sort by it, then clicks "Due" again
- **THEN** the list re-orders from the opposite end

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and
every filter added SHALL narrow the list further; each filter in use is
shown and can be removed on its own. A few of the list's own columns also
carry a quick filter box above the list, for the filters used most.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it
  brings back every row

### Requirement: The list remembers how it's arranged

Sorting the list and choosing which columns show SHALL be remembered for
that user on that table, so returning to the list later — even after signing
back in — shows it the same way.

#### Scenario: Return after hiding a column

- **WHEN** the user hides a column and later reopens the same table's list
- **THEN** the column is still hidden and the list is still sorted the way
  they left it

### Requirement: Act on many rows at once

The user SHALL be able to change or delete several selected rows from one
place.

#### Scenario: Change one field for many rows

- **WHEN** the user selects five rows and sets their "Status" to "Closed"
- **THEN** all five rows show "Closed"

### Requirement: See a row's nested rows without opening it

A row that holds its own nested rows, such as an order's line items, SHALL
let the user expand it in place to see them, without leaving the list.

#### Scenario: Expand and collapse a row

- **WHEN** the user expands a row that has nested order lines
- **THEN** its lines appear beneath it, and collapsing it hides them again

### Requirement: A read-only connected table can be browsed but not changed here

A table connected to a source the platform can't write back to SHALL still
be sortable and filterable like any other list, but the list offers no row
selection, no bulk change, and no way to add a row directly.

#### Scenario: A read-only source has no selection

- **WHEN** the user opens the list for a table connected to a read-only
  external source
- **THEN** there is no row selection and no way to bulk-edit or add a row
  from that list
