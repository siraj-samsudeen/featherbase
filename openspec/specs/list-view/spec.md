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

#### Scenario: Open a row

- **WHEN** the user clicks a row's link in the list
- **THEN** that row's full form opens

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

#### Scenario: Use a quick filter

- **WHEN** the user picks "Closed" in the quick filter above the list
- **THEN** only Closed rows show, and picking "All" brings every row back

### Requirement: Filters live in the page address

The filters on a list SHALL be kept in the page's address, so reloading the
page, using the browser's back button, or sharing the link shows the same
narrowed list.

#### Scenario: Open a filtered link

- **WHEN** the user opens a link to a table's list that carries a filter on
  "Stage"
- **THEN** the list opens already narrowed, with that filter shown

### Requirement: The list remembers how it's arranged

Sorting the list and choosing which columns show SHALL be remembered for
that user on that table, so returning to the list later — even after signing
back in — shows it the same way.

#### Scenario: Return after hiding a column

- **WHEN** the user hides a column and later reopens the same table's list
- **THEN** the column is still hidden and the list is still sorted the way
  they left it

### Requirement: The list offers what the user recently opened from it

Above a table's list, the user SHALL see the rows and filter combinations
they most recently opened from that table, each reachable in one click. The
trail is private to them.

#### Scenario: Return to a recent filter

- **WHEN** the user filtered the table by "note = searchable", opened a row,
  and later comes back to the table's list
- **THEN** that row and that filter appear as recent, and clicking the filter
  applies it again

### Requirement: Act on many rows at once

The user SHALL be able to change or delete several selected rows from one
place.

#### Scenario: Change one field for many rows

- **WHEN** the user selects five rows and sets their "Status" to "Closed"
- **THEN** all five rows show "Closed"

#### Scenario: Delete several rows

- **WHEN** the user selects two rows and deletes them
- **THEN** both rows leave the list and the total count drops by two

### Requirement: See a row's nested rows without opening it

A row that holds its own nested rows, such as an order's line items, SHALL
let the user expand it in place to see them, without leaving the list.

#### Scenario: Expand and collapse a row

- **WHEN** the user expands a row that has nested order lines
- **THEN** its lines appear beneath it, and collapsing it hides them again

### Requirement: Nested rows are only as visible as the rows they belong to

A list of nested rows, such as order lines, SHALL show only the lines that
belong to rows the user may see. If the user cannot see the owning table at
all, the list of its lines is empty.

#### Scenario: Only my own orders' lines

- **WHEN** a salesperson who may see only the orders they created lists the
  order lines
- **THEN** they see lines from their own orders and none from anyone else's

### Requirement: A list stays current while it is open

A list SHALL refresh on its own when another person adds, changes or deletes
a row of that table, without the user reloading.

#### Scenario: A colleague adds a row

- **WHEN** the user has a table's list open and someone else adds a row to
  that table
- **THEN** the new row appears in the user's list without a reload

### Requirement: A read-only connected table can be browsed but not changed here

A table connected to a source the platform can't write back to SHALL still
be sortable and filterable like any other list, but the list offers no row
selection, no bulk change, and no way to add a row directly.

#### Scenario: A read-only source has no selection

- **WHEN** the user opens the list for a table connected to a read-only
  external source
- **THEN** there is no row selection and no way to bulk-edit or add a row
  from that list

### Requirement: A change to many rows happens to all of them or none

When the user changes or deletes several rows at once and one of them can't
be changed, no row SHALL change, and the user SHALL be told which row and
why. A table connected to an outside source can't undo a partly done change,
so there every row is tried and the rows that failed stay selected, each
named with its reason.

#### Scenario: One row can't be deleted

- **WHEN** the user selects three rows and deletes them, and the second has
  been submitted meanwhile
- **THEN** all three rows stay, and the user is told that nothing was
  deleted because the second row is submitted

#### Scenario: A connected table deletes what it can

- **WHEN** the user deletes three rows of a table connected to an outside
  database, and one of them was removed there meanwhile
- **THEN** the other two are deleted, the missing row stays selected, and
  the user is told that two of three were deleted and that row was not found

### Requirement: A refused change to many rows says what to fix

When a change to several rows is refused, the user SHALL be told each field
that was refused and why, not only that the values were invalid.

#### Scenario: A required field is cleared

- **WHEN** the user selects rows and clears a field every row must have
- **THEN** the user is told that field is required, and no row changes

### Requirement: Deleting many rows asks first

Before deleting several selected rows, the list SHALL ask the user to
confirm, naming how many rows will be deleted. Backing out deletes nothing.

#### Scenario: The user backs out

- **WHEN** the user selects three rows, chooses to delete them and then
  cancels
- **THEN** all three rows stay and are still selected
