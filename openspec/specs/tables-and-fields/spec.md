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

A column SHALL be typed as one of a set of kinds — among them plain text, a
longer text block, a whole number, a decimal, money, a date or date and time,
yes/no, one choice from a list the builder defines, a link to a row in
another table, a file attachment, or a repeating group of rows nested inside
this one. The set can grow; each kind decides how the column is entered and
shown, not just how it's stored.

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
