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
connect. A table outside the list is refused, however it is asked for. When
several tables are asked for together and any one is refused, none of them
is connected.

#### Scenario: A table that isn't on the list

- **WHEN** a data source lists one allowed table and a System Manager tries to
  connect a different table from it
- **THEN** it is refused, saying the table is not on the data source's list
- **AND** the allowed table connects normally

#### Scenario: One refused table among several

- **WHEN** a System Manager asks to connect two allowed tables and one that is
  not on the list, all at once
- **THEN** the request is refused, naming the table that is not on the list
- **AND** neither allowed table is connected

### Requirement: Incomplete table restrictions explain how to qualify a name

Saving a data source SHALL refuse an SQL table restriction that lacks its namespace, giving correction guidance on the restriction field: schema and table for Postgres, database and table for MySQL, catalog, schema and table for DuckDB warehouses. CSV folders SHALL continue to accept exact relative filenames without a namespace; a default namespace SHALL NOT fill in an incomplete restriction.

#### Scenario Outline: An incomplete restriction is refused before it is saved

```gherkin
Given the user manages a "<engine>" source with default namespace "<default>"
When the user saves its table restriction as "<entry>"
Then saving is refused with restriction-field guidance to use "<format>"
And the source is not registered

Examples:
  | engine   | default   | entry             | format               |
  | postgres | public    | stores            | schema.table         |
  | postgres |           | stores            | schema.table         |
  | mysql    | shop      | stores            | database.table       |
  | duckdb   | gold.main | stores            | catalog.schema.table |
  | duckdb   | gold      | main.stores       | catalog.schema.table |
  | postgres | public    | public.ok,stores  | schema.table         |
```

#### Scenario Outline: An explicit restriction saves without contacting its source

```gherkin
Given the user manages a "<engine>" source with default namespace ""
When the user saves its table restriction as "<entry>"
Then the source is registered with exactly that restriction

Examples:
  | engine     | entry                 |
  | postgres   | public.stores         |
  | mysql      | shop.stores           |
  | duckdb     | gold.main.stores      |
  | csv-folder | stores.csv            |
  | csv-folder | finance/stores.csv    |
```

#### Scenario: A refused edit preserves the saved restriction

```gherkin
Given a Postgres source is registered with restriction "public.stores"
When the user changes its restriction to "public.stores,stores"
Then saving is refused with restriction-field guidance to use "schema.table"
And its stored restriction is still "public.stores"
```

### Requirement: Stored incomplete restrictions never gain implied access

An existing incomplete restriction SHALL remain unchanged and SHALL NOT gain access through a default namespace; a refusal SHALL explain how to correct it. An exact allowed entry in the same stored restriction SHALL continue to work.

#### Scenario: A stored bare name remains refused with correction guidance

```gherkin
Given a Postgres source already stores the restriction "stores" for its public stores table
When the user tries to connect the public stores table
Then connection is refused with guidance to use "schema.table"
And its stored restriction is still "stores"
```

#### Scenario: A qualified entry still works beside an old incomplete entry

```gherkin
Given a Postgres source already stores the restriction "stores,public.stores" for its public stores table
When the user tries to connect the public stores table
Then the public stores table connects
And its stored restriction is still "stores,public.stores"
```

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

### Requirement: Read and write a connected table at its source

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

### Requirement: "Rows I own" is refused on a connected table

A permission limiting a person to the rows they created SHALL save on a connected table, but every read and write through it SHALL be refused, since a connected table can't be limited to the rows a person created. Nothing is shown through such a grant.

#### Scenario: "Rows I own" is refused when it's used

- **WHEN** a builder limits a person's access to a connected table to only the rows they created, and that person opens the table
- **THEN** the permission saved, but the person is refused, and is refused again when they try to change a row

### Requirement: Concurrent edits are caught when the source can tell

WHEN a connected table's rows carry a last-changed time, saving a row SHALL
check it hasn't changed there since it was loaded, and refuse the save if it
has. Without a last-changed time to check, a save simply overwrites whatever
is there, and a row open for editing SHALL say so.

#### Scenario: No last-changed time, no check

- **WHEN** a connected table has no last-changed time and a person saves a row
  that was changed at the data source after it was loaded
- **THEN** the save goes through and replaces what is there

#### Scenario: The form warns that saves aren't checked

- **WHEN** the user opens a row of a connected table that has no last-changed
  time and can be edited
- **THEN** the form tells them, for as long as the row is open, that changes
  made at the data source meanwhile won't be noticed and saving replaces them

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

### Requirement: A Featherbase table can link to a connected table

A Featherbase table SHALL be able to link its rows to rows of a connected table. Saving checks the linked row on the data source: the row saves when the linked row is there, and the user is told it does not exist when it is not. While the data source can't be reached, a save that sets such a link is refused, because the link can't be checked.

#### Scenario: Link a local row to a connected row

- **WHEN** the user saves a row in a "Holders" table whose account link points at an account that exists in a connected "Accounts" table
- **THEN** the row saves with that link

#### Scenario: Link to a connected row that isn't there

- **WHEN** the user saves a row whose account link names an account the data source does not have
- **THEN** the row is not saved, and the user is told that account does not exist

#### Scenario: Link to a connected row while its data source is down

- **WHEN** the "Accounts" data source stops responding and the user saves a "Holders" row with an account link
- **THEN** the row is not saved, and the user is told the data source can't be reached

### Requirement: Tables connect through a login that owns none of them

A Postgres data source whose login may read its tables but owns none of them
SHALL find the column that identifies each row, and let the user connect the
table, exactly as when the login owns the tables.

#### Scenario: Shops connect through a login that owns nothing

```gherkin
Given the user is a System Manager
And a Postgres database with a shop table whose rows are identified by their id
And a data source whose login may only read that table and owns nothing
When the user browses the data source
Then the shop table is offered for connecting
When the user connects it
Then the user sees the database's shops listed in Featherbase
```

### Requirement: Name each table as it is connected

When connecting a data source's tables, the user SHALL be able to give each
one the name it will have in Featherbase; a table left as proposed keeps the
proposed name.

#### Scenario: The tables read "Shelf" and "Bin"

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a data source for that database
When the user connects its shelf and bin tables, naming them "Shelf" and "Bin"
Then the user sees tables called "Shelf" and "Bin" in Featherbase
```

### Requirement: A link column is named after what it points at

A column that points at another table's rows SHALL be labelled by what it
points at, so a bin's shelf column reads "Shelf", not "Shelf Id".

#### Scenario: A bin's shelf is labelled "Shelf"

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And its shelf and bin tables connected as "Shelf" and "Bin"
When the user opens a bin
Then the user sees its link to a shelf labelled "Shelf"
```

### Requirement: A connected row reads by its title

Wherever Featherbase shows a row by its title (the value that names it, such
as a shelf's name), a row of a connected table SHALL show that title, never
its id. The user sees only the titles of rows they may read.

#### Scenario: A bin's shelf reads "Top" on the relationship map

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And its shelf and bin tables connected as "Shelf" and "Bin"
And a bin on the shelf titled "Top"
When the user opens that bin's relationship map
Then the user sees its shelf as "Top"
```

#### Scenario: A shelf the user may not read keeps its title hidden

```gherkin
Given a Postgres database of shelves and the bins on each shelf
And its shelf and bin tables connected as "Shelf" and "Bin"
And a bin on the shelf titled "Top"
And the user may read bins but not shelves
When the user opens that bin's relationship map
Then the user does not see "Top"

### Requirement: Explore follows linked rows within one connected Postgres source

The user SHALL explore direct links within one Postgres data source over all matching upstream records, with exact totals and groups and the same access restrictions at every step. Other sources, indirect links and requests beyond the existing limits SHALL remain refused; selecting records and summing values remain unchanged.

#### Scenario: All connected floors appear before selecting a store

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores stores followed by floors without selecting a store
Then the user sees the three linked floors with a total of three
```

#### Scenario: Selecting a store narrows its floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for North
Then the user sees only North's two floors with a total of two
```

#### Scenario: Selecting an empty store shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for Empty
Then the user sees no floors with a total of zero
```

#### Scenario: An empty upstream search shows no floors

```gherkin
Given a connected Postgres source has North with two floors, South with one floor and Empty with none
When the user explores floors for stores matching "Missing" without selecting a store
Then the connected result has no floors with a total of zero
```

#### Scenario: A store beyond the displayed page still contributes its floors

```gherkin
Given a connected Postgres source has more than five hundred stores
When the user explores floors without selecting a store from that source
Then floors linked to stores beyond the displayed page contribute to the exact result
```
