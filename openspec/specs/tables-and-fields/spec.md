# Tables and Fields

## Purpose

A Table is a builder's own typed structure — like a spreadsheet tab with
columns that know their type. Building one, and reshaping it afterwards,
needs no code: every list, form and permission for it is generated from what
the builder describes here.

## Requirements

### Requirement: Build a table by describing its columns

Building a table SHALL take only a name and its columns, entered one at a
time, typed as a header row and sample values, or dropped in as a CSV or
Excel file — a dropped file also imports its rows once the table is created.
Building lands the builder on the new table's own list, ready to use.

#### Scenario: Type a column list instead of adding rows one by one

- **WHEN** the builder pastes "Employee Name, Date of Birth, Salary" as a
  header line
- **THEN** three columns appear, each already guessed at a sensible type from
  values pasted below it

#### Scenario: Build and import from a file in one step

- **WHEN** the builder drops a CSV of customer data onto the builder
- **THEN** the columns are inferred from its headers and sample rows, and
  creating the table also loads that file's rows into it

### Requirement: A column's type says what it holds and how it's shown

Each column SHALL have a type, such as text, a number, a date, a choice from
a list, or a link to a row in another table. The type decides how the column
is filled in and shown, not just how it's stored.

#### Scenario: Link one table's rows to another's

- **WHEN** a column is typed as a link to the Customers table
- **THEN** filling it means picking one of that table's rows, not typing free
  text

### Requirement: A column can be marked required

Marking a column required at creation SHALL mean a row can't be saved until
that column has a value; the form marks it and shows the missing-value error
inline.

#### Scenario: A required column blocks an empty save

- **WHEN** a row is saved with a required column left blank
- **THEN** the save is refused and the blank column is called out on the form

### Requirement: Add a column without rebuilding the table

A table already in use SHALL gain a new column at any time, from its own
Columns screen, without touching the rows already in it. The new column
starts empty on every existing row.

#### Scenario: Add a column after rows already exist

- **WHEN** a builder adds a "Department" column to a table with rows in it
- **THEN** the column appears on every row, empty until someone fills it in

### Requirement: Rename a column or its label without losing data

The Columns screen SHALL let a builder relabel a column (the name shown to
everyone) or rename it (its machine name) at any time; either way, the
values already stored under it stay attached and readable under the new
name.

#### Scenario: Fix a misspelled column name

- **WHEN** a column named "glor" is renamed to "floor"
- **THEN** every row's existing value moves with it and is readable under
  "floor"

### Requirement: Choose how each new row gets its id

Building a table SHALL offer a choice of how its rows are identified: a
counted series with a prefix the builder sets, a random id, an id the person
saving the row types themselves, or an id taken from one of the table's own
columns. This choice can be changed later without disturbing rows already
saved.

#### Scenario: Preview a series before creating the table

- **WHEN** the builder sets the id to a series prefixed "EMP-"
- **THEN** the first rows are shown as EMP-001, EMP-002, EMP-003 before
  anything is saved

### Requirement: Shaping a table requires the builder authority

Creating a table, adding or renaming its columns, and changing how its rows
are identified SHALL all require the same authority: System Manager. A
table the platform itself depends on SHALL NOT have its columns changed this
way at all.

#### Scenario: A platform table's columns are closed to editing

- **WHEN** a builder opens the Columns screen for a table the platform
  depends on
- **THEN** it says the table's columns belong to the platform and offers no
  way to add or rename one

### Requirement: A choice column accepts only its listed choices

A column typed as a choice from a list SHALL accept only one of that list's
choices, or be left empty; any other value is refused and the column is
called out.

#### Scenario: A value that isn't on the list

- **WHEN** a row is saved with "Urgent" in a priority column whose choices
  are Low and High
- **THEN** the save is refused and the priority column is called out

### Requirement: A link must point at a row that exists

A link column SHALL hold only the id of a row that exists in the table it
links to, in a row and in its nested rows alike. A save naming a missing row
is refused and calls out the column; an empty link is allowed.

#### Scenario: Link to a customer that isn't there

- **WHEN** a row is saved linking to the customer "Ghost Ltd", which does not
  exist
- **THEN** the save is refused and the customer column is called out

### Requirement: A column can be marked unique

A column marked unique SHALL refuse a value another row already holds in it,
calling out the column, rather than storing a second copy.

#### Scenario: Reuse a code another row has

- **WHEN** a row is saved with the code "DUP" that another row already has
- **THEN** the save is refused and the code column is called out as needing
  to be unique

### Requirement: A column can start with a default value

A column given a default value SHALL take it on a new row that leaves the
column empty. A value the person enters wins over the default.

#### Scenario: A new row picks up the default

- **WHEN** a row is created without a stage, in a table whose stage column
  defaults to "Open"
- **THEN** the row is saved with the stage "Open"

### Requirement: A read-only column is set by the system, not by whoever saves

A column marked read-only SHALL keep the value the system gives it; a value
sent for it by whoever saves the row is ignored, on a new row and on an edit.

#### Scenario: Someone tries to set a read-only column

- **WHEN** a user saves a row with their own value in a read-only column
- **THEN** the row is saved, and that column keeps the system's value

### Requirement: A save naming an unknown column is refused

A save that includes a column the table does not have SHALL be refused,
naming that column, rather than quietly dropping the value.

#### Scenario: A misspelled column in a save

- **WHEN** an integration saves a row with "titel" where the table has
  "title"
- **THEN** the save is refused and "titel" is named as unknown

### Requirement: Every row records who made it and who last changed it

Every row SHALL record who created it and when, and who last changed it and
when, without anyone filling these in.

#### Scenario: An edit updates the last change

- **WHEN** a user edits a row
- **THEN** the row still names who created it and when, and now names the
  user and the time of this edit as its last change

### Requirement: Nested rows save together with their parent

A column can hold nested rows — a small table of lines inside each row, such
as the items on an order. A row and its nested rows SHALL be saved in one
step: if any nested row is invalid, nothing is saved, and the problem is
called out on that line.

#### Scenario: One bad line stops the whole order

- **WHEN** an order is saved with a new title and two lines, one of which has
  an invalid quantity
- **THEN** neither the new title nor either line is saved, and the bad line
  is called out

### Requirement: The nested rows sent with a save are the whole list

Saving a row with its nested rows SHALL leave exactly the lines sent, in the
order sent: lines left out are removed, kept lines are updated and new lines
are added. A save that leaves the nested rows out altogether leaves them as
they were.

#### Scenario: Drop a line by leaving it out

- **WHEN** an order with lines a, b and c is saved again with only an edited
  c followed by a new line d
- **THEN** the order has exactly c and d, in that order

### Requirement: Nested rows are saved only through their parent

A nested row SHALL be created and changed only by saving the row it belongs
to; saving one on its own is refused.

#### Scenario: Save a line on its own

- **WHEN** someone tries to save an order line by itself, without its order
- **THEN** the save is refused

### Requirement: A required nested-rows column needs at least one row

A nested-rows column marked required SHALL refuse a new row with no lines,
and an edit that empties the lines; an edit that leaves the lines out keeps
the ones already there.

#### Scenario: An order with no lines

- **WHEN** an order whose lines are required is created with no lines
- **THEN** the save is refused and the lines column is called out

### Requirement: Checks and automations run inside the save

The checks and automations attached to a table SHALL run as part of every
save, before and after the row is written, as one step. Anything they change
on the row is saved with it, and if any of them refuses, nothing from that
save is kept.

#### Scenario: An automation fills in a column

- **WHEN** a table's automation upper-cases the title as each row is saved
- **THEN** the saved row carries the upper-cased title

#### Scenario: A refusal after the row is written

- **WHEN** an automation refuses a row after the row and its lines were
  written
- **THEN** neither the row nor its lines are kept

### Requirement: Rename a row and every link follows

A row's id SHALL be changeable after it is saved. The row keeps its values
and nested rows, and every link to it, in any table and in nested rows,
follows to the new id. An id another row already has is refused.

#### Scenario: Rename a customer

- **WHEN** the customer "Acme" is renamed "Acme Corp"
- **THEN** every order that linked to Acme, including its lines, now links to
  "Acme Corp"

#### Scenario: Rename onto an id already in use

- **WHEN** a customer is renamed to the id of another customer
- **THEN** the rename is refused and both customers are untouched

### Requirement: A cancelled row can't be changed

A row that has been cancelled SHALL NOT be edited; it stays as it was when
cancelled, and amending it is the way to carry on.

#### Scenario: Edit a cancelled row

- **WHEN** a user tries to change a cancelled row
- **THEN** the change is refused

### Requirement: Submitting and cancelling follow the row's stage

Only a row of a table set up for submitting SHALL be submitted; only a draft
can be submitted, and only a submitted row can be cancelled.

#### Scenario: Cancel a draft

- **WHEN** a user tries to cancel a row that is still a draft
- **THEN** the cancellation is refused

### Requirement: An amended copy is named after the row it replaces

The draft copy made by amending a cancelled row SHALL take the original's id
followed by a running number, and record which row it amends.

#### Scenario: Amend the same row twice

- **WHEN** the cancelled row "INV-004" is amended, and then amended again
- **THEN** the copies are named "INV-004-1" and "INV-004-2"

### Requirement: Removing a column keeps its values

Taking a column out of a table's definition SHALL hide it without deleting
the values stored under it, and putting a column of the same name back
brings those values back. Values are deleted only when the builder
explicitly asks for that.

#### Scenario: Put a column back

- **WHEN** a "points" column is taken out of a table and later added back
- **THEN** every row shows the points it had before

### Requirement: A column's type is fixed once created

Changing an existing column's type SHALL be refused, naming the column; the
column keeps its type and its values.

#### Scenario: Turn a text column into a number

- **WHEN** a builder tries to change a text column to a number column
- **THEN** the change is refused and the column is named

### Requirement: A settings table holds one set of values

A table can be a settings table: one set of values for the whole instance
rather than a list of rows. It SHALL show its defaults before anything is
saved, and saving changes that one set in place.

#### Scenario: Open settings nobody has saved yet

- **WHEN** a settings table whose count defaults to 5 is opened before anyone
  has saved it
- **THEN** it shows a count of 5

### Requirement: A table's name is its own, ignoring letter case and spacing

Building a table SHALL be refused when its name matches an existing table's
name, or storage the platform itself uses, once letter case and spacing are
ignored.

#### Scenario: Same name in different letters

- **WHEN** a builder creates "audit owned" while a table "Audit Owned"
  already exists
- **THEN** the new table is refused and the existing one is unchanged

### Requirement: Every table can be found in one list

One list SHALL show every table: the builder's own tables grouped by module,
and the platform's own tables in a single group that starts folded.

#### Scenario: Find a platform table

- **WHEN** the user opens the list of all tables and unfolds the platform's
  group
- **THEN** platform tables such as Person and Role appear there

### Requirement: Add a column of your own to any table

A System Manager SHALL be able to add a column of their own to any table,
the platform's included, and that column is kept when the platform's own
definitions are refreshed by an update. Removing it keeps the values stored
under it.

#### Scenario: A column added to Person survives an update

- **WHEN** a System Manager adds a column to Person and the platform's own
  definition of Person is then refreshed
- **THEN** the added column is still there with its values

### Requirement: Adjust a column without changing the table

A System Manager SHALL be able to change how a column behaves — its label,
whether it is hidden, required or read-only, its default or its choices —
as an adjustment layered over the table's own definition. Removing the
adjustment restores the original.

#### Scenario: Relabel and then restore

- **WHEN** a column's label is adjusted and the adjustment is later removed
- **THEN** the column shows the new label while the adjustment exists, and
  its original label afterwards

### Requirement: Carry customizations to another instance

A System Manager SHALL be able to export a table's added columns and
adjustments as one bundle and import it elsewhere; importing recreates what
is missing and never duplicates what is already there.

#### Scenario: Import the same bundle twice

- **WHEN** a bundle is imported into an instance that already has everything
  in it
- **THEN** nothing new is created

### Requirement: A number column gives back a number

A whole number SHALL read back as a number, not as text, including from a table connected to another database.

#### Scenario: Read back a count

- **WHEN** the user saves a count of 13 and reads the row back
- **THEN** the count is the number 13, so adding it to other counts gives a sum, not joined text

#### Scenario: Read a count from a connected table

- **WHEN** a table connected to another database holds a count of 13 and the user reads that row
- **THEN** the count is the number 13, as it would be in a table kept here

### Requirement: A JSON column holds the data typed into it

JSON typed into a form SHALL be saved as the data it describes. Text that isn't valid JSON SHALL be refused at that field with a message, and the row SHALL NOT be saved.

#### Scenario: Type a small object

- **WHEN** the user types `{"shelf": 3}` into a JSON column and saves
- **THEN** the column holds an object whose shelf is 3, not the text of it

#### Scenario: Type something that isn't JSON

- **WHEN** the user types `{shelf: 3` into a JSON column and saves
- **THEN** the field says it must be valid JSON and nothing is saved
