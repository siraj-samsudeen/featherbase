# External Data Sources

## Purpose

A builder can point a table at data that already lives somewhere else — a
Postgres or MySQL database, a DuckDB warehouse, or a folder of CSV files —
and use it the way any other table is used, without copying the data in or
changing anything at the other end.

## Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a data
source — a Postgres or MySQL database, a DuckDB warehouse, or a folder of
CSV files — naming where its connection details are kept rather than typing
them in; those details are never stored in the open, shown back, or written
to a log. Only a System Manager can register or manage a data source.

#### Scenario: Connect and check it

- **WHEN** a builder registers a Postgres data source and asks Featherbase to
  test it
- **THEN** Featherbase connects and reports whether it succeeded, without
  ever displaying the connection details

### Requirement: Browse what a data source holds

Opening a data source SHALL let the builder see its tables and the columns
each one has, with a type Featherbase proposes for each column. A table with
no single column that uniquely identifies each row SHALL be shown as
unusable, saying why.

#### Scenario: A table with no way to address a row

- **WHEN** a builder browses a data source and opens a table whose only
  unique key spans two columns together
- **THEN** it is shown as unusable, saying it needs one column that
  identifies each row on its own

### Requirement: Turn a data source's table into a Featherbase table

A builder SHALL be able to turn one of a data source's tables into a
Featherbase table in place: no copy of the data is made, and Featherbase
never creates, changes or drops anything at the other end. A column left out
when connecting the table is never read or written by Featherbase. Rows in a
connected table can't be submitted or cancelled.

#### Scenario: Turn on a source table without touching its schema

- **WHEN** a builder turns a "Vehicles" table from a data source into a
  Featherbase table
- **THEN** the table appears in Featherbase, and the database it came from is
  exactly as it was before

### Requirement: Read and write through a connected table

Listing, filtering, sorting and paging a connected table SHALL run against
the data source directly, not a local copy. Where the data source allows
writing, saving and deleting a row SHALL write directly there too, touching
only the columns the table maps — a column the table doesn't map keeps
whatever value it already had. Saving a new row without an id lets the data
source assign one when it can; otherwise the id must be given when the row
is saved.

#### Scenario: Editing leaves the source's own columns alone

- **WHEN** someone edits one mapped field on a connected row that also
  carries a column Featherbase doesn't map
- **THEN** only the mapped field changes at the data source, and the
  unmapped column is untouched

#### Scenario: "Rows I own" can't be granted here

- **WHEN** a builder tries to limit a person's access to a connected table to
  only the rows they created
- **THEN** the permission is refused: a connected table can't be limited to
  rows a person created

### Requirement: Concurrent edits are caught when the source can tell

WHEN a connected table's rows carry a last-changed time, saving a row SHALL
check it hasn't changed there since it was loaded, and refuse the save if it
has. Without a last-changed time to check, a save simply overwrites whatever
is there.

#### Scenario: Someone else changed the row first

- **WHEN** a person saves a row after something else has changed it at the
  data source since it was loaded
- **THEN** the save is refused, and the user can reload the row to see what
  changed

### Requirement: A read-only data source keeps its tables view-only

A data source marked read-only, and a kind of data source that can't write
at all, SHALL leave every table that uses it read-only, and Featherbase SHALL
say so on the table itself, before anyone starts editing.

#### Scenario: Trying to edit on a read-only data source

- **WHEN** someone opens a row from a table whose data source is read-only
- **THEN** there is no way to save, edit or delete from that screen, and the
  screen names the data source it's reading from

### Requirement: A data source outage doesn't take down anything else

WHEN a data source can't be reached, THE tables that use it SHALL show the
failure plainly instead of an empty list, while every other table in
Featherbase keeps working normally.

#### Scenario: One data source goes down

- **WHEN** a connected data source stops responding
- **THEN** opening one of its tables shows that it can't be reached, and
  unrelated tables open normally
