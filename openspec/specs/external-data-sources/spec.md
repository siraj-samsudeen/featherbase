# External Data Sources

## Purpose

A builder can point a table at data that already lives somewhere else — a
Postgres or MySQL database, a DuckDB warehouse, or a folder of CSV files —
and use it the way any other table is used, without copying the data in or
changing anything at the other end.

## Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a
connection to a Postgres or MySQL database, a DuckDB warehouse, or a folder
of CSV files, naming where its connection details are kept rather than
typing them in; those details are never stored in the open, shown back, or
written to a log. Only a System Manager can register or manage a connection.

#### Scenario: Connect and check it

- **WHEN** a builder registers a connection to a Postgres database and asks
  Featherbase to test it
- **THEN** Featherbase connects and reports whether it succeeded, without
  ever displaying the connection details

### Requirement: Browse what a source holds

Opening a connection SHALL let the builder see its tables and the columns
each one has, with a type Featherbase proposes for each column. A table with
no single column that uniquely identifies each row SHALL be shown as
unusable, saying why.

#### Scenario: A table with no way to address a row

- **WHEN** a builder browses a connection and opens a table whose only
  unique key spans two columns together
- **THEN** it is shown as unusable, saying it needs one column that
  identifies each row on its own

### Requirement: Turn a source's table into a Featherbase table

A builder SHALL be able to turn one of a connection's tables into a
Featherbase table in place: no copy of the data is made, and Featherbase
never creates, changes or drops anything at the other end. A column left out
when connecting the table is never read or written by Featherbase. A table
connected this way can't be put through Featherbase's own submit-and-cancel
workflow, since that needs a status column the other end doesn't have.

#### Scenario: Turn on a source table without touching its schema

- **WHEN** a builder turns a "Vehicles" table from a connected database into
  a Featherbase table
- **THEN** the table appears in Featherbase, and the database it came from is
  exactly as it was before

### Requirement: Read and write through a connected table

Listing, filtering, sorting and paging a connected table SHALL run against
the other end directly, not a local copy. Where the connection allows
writing, saving and deleting a row SHALL write directly there too, touching
only the columns the table maps — a column the table doesn't map keeps
whatever value it already had. Saving a new row without an id lets the other
end assign one when it can; otherwise the id must be given when the row is
saved.

#### Scenario: Editing leaves the source's own columns alone

- **WHEN** someone edits one mapped field on a connected row that also
  carries a column Featherbase doesn't map
- **THEN** only the mapped field changes at the other end, and the unmapped
  column is untouched

#### Scenario: "Rows I own" can't be granted here

- **WHEN** a builder tries to limit a person's access to a connected table to
  only the rows they created
- **THEN** the permission is refused, because the other end has no such
  column for Featherbase to check

### Requirement: Concurrent edits are caught when the source can tell

WHEN a connected table's rows carry a last-changed time, saving a row SHALL
check it hasn't changed there since it was loaded, and refuse the save,
showing the current row, if it has. Without a last-changed time to check, a
save simply overwrites whatever is there.

#### Scenario: Someone else changed the row first

- **WHEN** a person saves a row after something else has changed it at the
  other end since it was loaded
- **THEN** the save is refused and the row's current values are shown instead

### Requirement: A read-only connection keeps its tables view-only

A connection marked read-only, and a kind of connection that can't write at
all, SHALL leave every table that uses it read-only, and Featherbase SHALL
say so on the table itself, before anyone starts editing.

#### Scenario: Trying to edit on a read-only connection

- **WHEN** someone opens a row from a table whose connection is read-only
- **THEN** there is no way to save, edit or delete from that screen, and the
  screen names the connection it's reading from

### Requirement: A connection outage doesn't take down anything else

WHEN a connection can't be reached, THE tables that use it SHALL show the
failure plainly instead of an empty list, while every other table in
Featherbase keeps working normally.

#### Scenario: One connection goes down

- **WHEN** a connected source stops responding
- **THEN** opening one of its tables shows a connection error, and unrelated
  tables open normally
