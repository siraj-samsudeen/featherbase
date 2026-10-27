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

#### Scenario: A folder or warehouse that can't be reached

- **WHEN** a builder tests a data source whose folder or warehouse file is
  missing
- **THEN** the test reports that it failed and says why, and the data source
  shows that its last check failed

### Requirement: A data source can be limited to named tables

A System Manager SHALL be able to list the only tables a data source may
connect. A table outside the list is refused, however it is asked for.

#### Scenario: A table that isn't on the list

- **WHEN** a data source lists one allowed table and a System Manager tries to
  connect a different table from it
- **THEN** it is refused, saying the table is not on the data source's list
- **AND** the allowed table connects normally

### Requirement: A data source that is in use can't be removed

A data source SHALL NOT be removed while any table is still connected
through it.

#### Scenario: Remove it too soon

- **WHEN** a System Manager tries to remove a data source that still has a
  connected table
- **THEN** it is refused, naming a table that still uses it
- **AND** once that table is deleted, the data source can be removed

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

### Requirement: Browsing shows what is already connected

Browsing a data source SHALL show which of its tables are already connected
and link to them, and SHALL NOT offer to connect the same table twice.

#### Scenario: Already connected

- **WHEN** a builder opens a data source with one of its tables already
  connected
- **THEN** that table is shown as connected, with a link, and cannot be
  selected again

### Requirement: Links between a source's tables carry over

WHEN a table in a data source points at another through a foreign key, THE
connected tables SHALL point at each other the same way, in whichever order
they are connected, so the user can follow the link from one row to the other.

#### Scenario: Connect the child before the parent

- **WHEN** a builder connects an accidents table that points at a vehicles
  table, and connects the vehicles table afterwards
- **THEN** the accidents' vehicle column becomes a link to vehicles as soon as
  both are connected

### Requirement: Columns that look like secrets are never connected

A column whose name suggests a credential, such as an API key or password,
SHALL never be connected, shown, searched or filtered on, and a table whose
only identifying column looks like one cannot be connected at all.

#### Scenario: An API key column

- **WHEN** a builder connects a table that has an api key column
- **THEN** the column is left out, and cannot be listed, read or filtered by

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

#### Scenario: Counting and filtering happen at the source

- **WHEN** a chart counts a connected table's rows by one of its columns, or a
  list is filtered by a pattern or a list of values
- **THEN** the answer reflects what the data source holds right now, with no
  local copy involved

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

#### Scenario: No last-changed time, no check

- **WHEN** a connected table has no last-changed time and a person saves a row
  that was changed at the data source after it was loaded
- **THEN** the save goes through and replaces what is there

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

#### Scenario: A warehouse can't be made writable

- **WHEN** a System Manager sets up a DuckDB warehouse data source as writable
- **THEN** it is refused, because a warehouse can only be read

### Requirement: Row limits still apply to connected tables

A person's limits on which rows they may see, and on rows they may change,
SHALL apply to a connected table as they do to any other: a data scope narrows
its lists, counts and single rows, and a change cannot move a row out of the
person's scope.

#### Scenario: A scoped person sees only their rows

- **WHEN** a person limited by a data scope to two of a connected table's rows
  opens its list
- **THEN** they see and count only those two rows

### Requirement: A file can't be imported into a connected table

Importing a spreadsheet into a connected table SHALL be refused, both when
checking and when importing, so a file is never written row by row into
someone else's database.

#### Scenario: Importing into a connected table

- **WHEN** the user checks or imports a file into a connected table
- **THEN** both are refused with the same message, saying the table is
  connected to a data source

### Requirement: An app can bring its own data sources

An app SHALL be able to name the data sources it needs and the tables to
connect from them, and installing it connects them; uninstalling it removes
what it connected and the data source it created, but keeps a data source that
already existed. An app only names where connection details are kept, never the
details themselves.

#### Scenario: Install and uninstall

- **WHEN** an app that names a data source and two of its tables is installed,
  then uninstalled
- **THEN** the two tables appear on install and are gone after uninstall
- **AND** a data source that was there before the install is still there

#### Scenario: A connection string in an app is refused

- **WHEN** an app names a connection string, rather than where one is kept
- **THEN** the install is refused

### Requirement: A data source outage doesn't take down anything else

WHEN a data source can't be reached, THE tables that use it SHALL show the
failure plainly instead of an empty list, while every other table in
Featherbase keeps working normally.

#### Scenario: One data source goes down

- **WHEN** a connected data source stops responding
- **THEN** opening one of its tables shows that it can't be reached, and
  unrelated tables open normally

### Requirement: A data source never reaches the platform's own records

A data source SHALL always point at data outside the platform. Featherbase
SHALL refuse a data source that connects to its own database, however the
connection is spelled, and SHALL refuse to connect a table to the schema
where the platform keeps its own records, on any database.

#### Scenario: Pointing a data source at the platform's own database

- **WHEN** a System Manager registers a data source whose connection leads to
  the platform's own database
- **THEN** Featherbase refuses to use it, and no table connected through it
  can read or change a platform record

#### Scenario: Connecting a table to the platform's schema

- **WHEN** a System Manager connects a table to a relation in the platform's
  own schema on any data source
- **THEN** it is refused

### Requirement: A save hands back what it saved

Saving a row on a connected table SHALL hand back the row exactly as that save left it, even when something else writes to the same row at the same moment.

#### Scenario: Another program edits the row at the same moment

- **WHEN** the user saves a row while another program changes the same row at the data source
- **THEN** the user sees the values they saved, and the other program's change lands after the save rather than inside it

### Requirement: A new row needs an id Featherbase can find again

Saving a new row without an id SHALL be refused, before anything is written, when the data source fills in ids in a way Featherbase can't read back.

#### Scenario: A data source that makes up its own ids

- **WHEN** a data source fills in a new row's id itself, for example by generating a random one, and the user saves a new row without giving an id
- **THEN** the save is refused, and no row is added at the data source

### Requirement: A refused save says why in plain words

When a data source refuses a save or a delete, because a value it needs is missing, a link points at a row it doesn't have, a value breaks one of its rules or doesn't fit, or other rows there still point at the row, Featherbase SHALL tell the user in plain words, on the field concerned wherever it can tell which one. The data source's own error text SHALL NOT be shown to the user.

#### Scenario: The data source needs a value the form didn't ask for

- **WHEN** the data source starts requiring a value after its table was connected, and the user saves a row without it
- **THEN** the save is refused and that field is marked as required, with no database message on screen

#### Scenario: Deleting a row the data source still uses

- **WHEN** the user deletes a connected row that other rows at the data source still point at
- **THEN** the delete is refused with a plain message saying other rows still point at it, and the row stays
