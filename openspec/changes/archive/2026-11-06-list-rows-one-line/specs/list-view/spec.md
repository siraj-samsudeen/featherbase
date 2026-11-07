## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and
every filter added SHALL narrow the list further; each filter in use is
shown and can be removed on its own. A few of the list's own columns also
carry a quick filter above the list, for the filters used most. Filter boxes
SHALL be marked so password managers leave them alone, since they ask for no
login, and SHALL line up with each other.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it
  brings back every row

#### Scenario: A password manager leaves a filter box alone

- **WHEN** a person with a password manager opens a list with a "Name" filter
- **THEN** the box asks not to be filled in, and carries the manager's own mark to ignore it
- **AND** it keeps the same height and top edge as the filter boxes beside it

#### Scenario: Use a quick filter

- **WHEN** the user picks "Closed" in the quick filter above the list
- **THEN** only Closed rows show, and picking "All" brings every row back

## ADDED Requirements

### Requirement: A list row is one line

Every row of a list shown as a table, and its header, SHALL be one line, in both
the Table and Compact layouts, whatever its values hold. A long value SHALL be
clipped with an ellipsis and SHALL show in full on hover and on the row's page.
A column SHALL be as wide as its content up to a maximum. Compact stays the
list's short form: the row's name and two key values.

#### Scenario: A very long note

- **WHEN** a row holds a note of several hundred characters
- **THEN** the row is as tall as its neighbours and the note ends in an ellipsis
- **AND** hovering the note shows all of it

#### Scenario: A value that fits

- **WHEN** the person hovers a value that isn't clipped
- **THEN** no tooltip repeats it

### Requirement: A list says when more columns lie to the right

While columns lie past the right edge the list SHALL say so and offer a way to
scroll to them, and the row's name SHALL stay in view while scrolling sideways.

#### Scenario: More columns than fit

- **WHEN** a list has more columns than fit its width
- **THEN** a fade and an arrow show at the right edge, and the arrow scrolls right
- **AND** the row's name stays in view while scrolling, and the fade goes at the far right

### Requirement: A list's controls leave the room to its rows

The list's filter boxes, its Add filter button and its layout choices SHALL share
one line where they fit. The row for building a filter SHALL stay closed until
the person asks for it, and filters already applied SHALL still show and be
removable while it is closed. The row count SHALL read on the title's line. On a
desktop window of 1280×800 the first row SHALL start within the top two fifths,
not counting a notice across the window's top that lasts until the instance is set up.

#### Scenario: Opening a list

- **WHEN** a person opens a list with no filters
- **THEN** the Add filter button shows and the row for building a filter does not

#### Scenario: A filter already applied

- **WHEN** a person opens a list whose address carries a filter
- **THEN** the filter shows as a chip they can remove, with the row for building one still closed

### Requirement: The Add filter row offers the box its column calls for

The Value box of the row for building a filter SHALL suit the chosen column and
condition: the same picker as the quick filter for a link compared with = or !=,
a dropdown for a Choice compared with = or !=, a date or number input for those
columns, and a text box for `like`. A value SHALL NOT survive a change to a
different kind of box.

#### Scenario: A link column

- **WHEN** the person chooses a link column with =
- **THEN** Value is a picker of rows by name, and the filter matches the row picked

#### Scenario: Changing the condition

- **WHEN** the person types a number and changes the condition to `like`
- **THEN** Value becomes an empty text box

### Requirement: A link box reads as a picker and password managers leave it alone

A link box SHALL show that it is a picker, and password managers SHALL be asked to
leave it alone, in filters and on forms. Its list SHALL carry a search box at the
top and SHALL sort by the name shown wherever it has a name to sort by.

#### Scenario: Clicking a link filter

- **WHEN** the person clicks a link filter
- **THEN** the first values show sorted by name, and typing in the list's search box narrows them
