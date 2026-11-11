# External Data Sources

## Purpose

A builder can point a table at data that already lives somewhere else — a
Postgres database, a DuckDB warehouse, or a folder of CSV files —
and use it the way any other table is used, without copying the data in or
changing anything at the other end.

## Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a data
source — a Postgres database, a DuckDB file, or a folder of CSV
files — naming where its connection details are kept rather than typing them
in. A MotherDuck warehouse uses the instance's one MotherDuck token. Those
details are never stored in the open, shown back, or written to a log. Only a
System Manager can register or manage a data source.

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

Saving a data source SHALL refuse an SQL table restriction that lacks its namespace, giving correction guidance on the restriction field: schema and table for Postgres, catalog, schema and table for DuckDB warehouses. CSV folders SHALL continue to accept exact relative filenames without a namespace; a default namespace SHALL NOT fill in an incomplete restriction.

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

Opening a data source SHALL let a System Manager see its tables and their
columns, each with a proposed type. A database table with no single column
that identifies each row SHALL be shown as unusable for connecting, saying
why. A warehouse table declares no such column, so it SHALL be browsable all
the same: search its tables by database and schema, then preview a chosen
table's size, columns and first rows.

#### Scenario: A table with no way to address a row

- **WHEN** a builder browses a data source and opens a table whose only
  unique key spans two columns together
- **THEN** it is shown as unusable, saying it needs one column that
  identifies each row on its own

#### Scenario: A warehouse table's size and first rows show

```gherkin
Given a MotherDuck source reading the databases "sales" and "stock"
When the user opens "sales", picks the schema "main" and the table "stores"
Then they see how many rows and columns "stores" has, its first rows and its column names
```

#### Scenario: Someone who is not a System Manager sees no source

```gherkin
Given a MotherDuck source reading the databases "sales" and "stock"
When a user who is not a System Manager looks for it
Then the sidebar lists no data source, and opening the source's browser is refused
```

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
```

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

### Requirement: Connecting a table picks the column that names its rows

Connecting a table SHALL make its title the first column it has from this
order: name, title, label, full name, display name, first name. A table with
none of them is read by its values, like any table without a title.

#### Scenario: A shelf is titled by its label, not its aisle

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a shelf labelled "Top" in the "East" aisle
And its shelf and bin tables connected as "Shelf" and "Bin"
When the user opens that shelf
Then the user sees the shelf as "Top"
```

### Requirement: A connected table's list shows what a row is about

A connected table's list SHALL show its title and up to four more of its
columns, in the source's order. It leaves out the columns that only record
when a row was created or changed, and by whom.

#### Scenario: The shelf list leaves out when each shelf was created

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a shelf labelled "Top" in the "East" aisle
And its shelf and bin tables connected as "Shelf" and "Bin"
When the user opens the list of shelves
Then the user sees each shelf's label and aisle
And the user does not see when each shelf was created
```

### Requirement: A link to a table not connected yet says so

Where a row's value is shown, a column that points at a table not connected
yet SHALL show its value and say that table isn't connected yet.

#### Scenario: A bin's shelf says its table isn't connected

```gherkin
Given a Postgres database of shelves and the bins on each shelf
And only its bin table connected, as "Bin"
And the user may read bins
When the user opens a bin
Then the user sees that its shelf's table is not connected yet
And the user is not offered to connect it
```

### Requirement: A System Manager can connect that table from the row

A System Manager SHALL also be offered to connect that table, which opens the
data source's tables with it already chosen.

#### Scenario: A System Manager is offered the shelf table

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And only its bin table connected, as "Bin"
When the user opens a bin
Then the user sees that its shelf's table is not connected yet
And the user is offered to connect the shelf table
```

#### Scenario: The shelf table is ready to connect

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And only its bin table connected, as "Bin"
When the user opens a bin and takes the offer to connect the shelf table
Then the user sees the shelf table chosen, ready to connect
```

### Requirement: A text column with a declared length is one-line text

Connecting a table SHALL make a text column with a declared length one-line
text, however long its limit. Only text with no limit is long text.

#### Scenario: The parcel's sender reads on one line

```gherkin
Given a connected database of parcels on racks, where every parcel has a sender of up to 500 characters
And a parcel labelled "Blue box" on the rack "Top"
And the user may read parcels and racks
When the user opens that parcel
Then the user sees its sender on one line
And the user sees its instructions as long text
```

### Requirement: Choose which databases a warehouse source reads

The System Manager SHALL choose which databases the source reads, from the
account's own databases and those shared with it, and at least one must be
chosen. Only the chosen databases are offered for browsing.

#### Scenario: Only the two ticked databases appear

```gherkin
Given the instance's token can read five databases, among them "sales" and "stock"
When the user ticks "sales" and "stock" and saves the source
Then browsing the source offers "sales" and "stock" and no other database
```

#### Scenario: Saving stays blocked until a database is ticked

```gherkin
Given the instance's token can read databases
When the user has ticked no database
Then the source cannot be saved
```

### Requirement: Find a source and its databases from the sidebar

The sidebar SHALL list each data source and, under it, the databases it
reads, and choosing a database opens it in the browser.

#### Scenario: The source and its two databases are listed

```gherkin
Given a MotherDuck source reading the databases "sales" and "stock"
When the user looks at the sidebar
Then it shows the source with "sales" and "stock" under it
```

### Requirement: Return to the same warehouse context

Moving between the catalog and a preview, or returning from copy setup,
SHALL retain the chosen database, schema, search and table.

#### Scenario: The filtered catalog and chosen preview stay available

```gherkin
Given the user is previewing "stores" in "main" of "sales" after searching for "STORES"
When the user returns to the warehouse catalog
Then the catalog still shows only "stores" in "main" of "sales" for the search "STORES"
And the user can reopen the preview of "stores" without choosing it again
```

#### Scenario: Returning from copy setup restores the chosen preview

```gherkin
Given the user is previewing "stores" in "main" of "sales" after searching for "STORES"
When the user opens copy setup and follows the breadcrumb back to "stores"
Then the same preview of "stores" is selected
And the catalog still shows only "stores" in "main" of "sales" for the search "STORES"
```

### Requirement: Search copy choices without losing edits

A builder SHALL be able to search all copy mappings by their source name,
edited name, label or description. Searching SHALL preserve edits and keep
choices against the original source column, even while that column is hidden.

#### Scenario: A search for another column keeps the edited copy choices

```gherkin
Given the user has edited the copy mapping for "stores" in "main" of "sales"
When the user searches the mapping for "STATE_CODE"
Then only the mapping for "state_code" is offered
And clearing the mapping search restores the edited name and omitted city
```

### Requirement: Create a native copy with the chosen columns

Copying a warehouse table SHALL create an ordinary editable Table using the
chosen key and kept columns. The approved names, labels, descriptions and
source-column identities SHALL be saved; omitted source columns SHALL not
be added to the copy. The source key's value becomes the native Row ID.

#### Scenario: Submitting copy setup creates editable native rows

```gherkin
Given a warehouse table containing three stores
When the user creates a native copy keeping these columns
  | Source     | Name       | Label        | Description            |
  | code       | store_code | Store code   | Warehouse identifier   |
  | name       | store_name | Trading name | Warehouse trading name |
  | state_code | state_code | State code   | Warehouse state        |
Then the native copy lists stores "S001", "S002" and "S003"
And its ordinary row form uses the approved labels without the omitted city
And a correction made in that form is saved
```

### Requirement: A copy keeps long text and respects table restrictions

A warehouse string column other than the key SHALL be copied as unbounded
text, so a long value never fails the copy. A number wider than a native
number holds exactly (a DECIMAL over 15 digits, HUGEINT, UBIGINT) SHALL be
copied as text, never rounded. A source's table restriction
(`catalog.schema.table`) SHALL apply to preview, key checks, copying and
Copy again alike.

#### Scenario: A long note copies whole

- **WHEN** a System Manager copies a warehouse table whose note column holds a
  value longer than 140 characters
- **THEN** the native copy holds the whole value, and only the key column is
  bounded

#### Scenario: A restricted table cannot be read through copying

- **WHEN** a source is restricted to `stock.main.open_items` and someone asks
  to preview, check a key in, copy, or copy again `stock.main.fenced_items`
- **THEN** each request is refused, and `stock.main.open_items` still copies

### Requirement: Copy again follows the source without losing corrections

Copy again SHALL update unedited values, add new rows and keep corrections
using saved source mappings. Manual and scheduled refreshes SHALL serialize
one complete source observation and apply it atomically: a read or row failure
leaves rows, conflicts, history and provenance unchanged. Report matched,
changed and unchanged counts separately; ordinary imports remain best-effort.

#### Scenario: Copy again updates an unedited store and adds a new store

```gherkin
Given a native store copy with a person's correction to store "S002"
And the warehouse changes the unedited store "S001" and adds store "S004"
When the user chooses Copy again on the native copy
Then store "S001" has the changed warehouse name
And store "S004" is available as an ordinary native row
And store "S002" still has the person's correction
```

#### Scenario: A refused new store leaves the earlier source changes unapplied

```gherkin
Given a native store copy with a person's correction to store "S002"
And the warehouse changes the unedited store "S001" and adds store "S004"
And the native copy refuses the new store "S004"
When the user attempts Copy again on the native copy
Then the failed copy explains that no rows changed
And the original three stores remain without the new warehouse changes
And store "S002" still has the person's correction
```

### Requirement: Saved source mappings survive a later column rename

Renaming a copied key or data column through Columns SHALL retain its source
identity so the next copy still updates the same native rows. Renaming the
copied Table itself SHALL keep where it was copied from, so Copy again still
works under the new name.

#### Scenario: Copy again follows renamed native columns

```gherkin
Given a native store copy with a person's correction to store "S002"
And the copied key and trading-name columns have been renamed
And the warehouse changes the unedited store "S001" and adds store "S004"
When the user chooses Copy again on the native copy
Then the renamed columns contain the updated and added stores
And store "S002" still has the person's correction
```

### Requirement: Copies are discoverable and undoable as ordinary imports

Each copy SHALL appear in Past imports as one run. Undo SHALL use the existing
import rules: remove inserted rows, restore updated values including the
deleted-at-source marker, and protect rows edited after the import. Undoing
the initial rows does not delete the native Table.

#### Scenario: Undo restores the rows changed by Copy again

```gherkin
Given a native store copy with a person's correction to store "S002"
And the warehouse changes the unedited store "S001" and adds store "S004"
When the user copies again and undoes that copy from its import history
Then the original three stores remain without the new warehouse changes
And store "S002" still has the person's correction
```

### Requirement: Browsing reopens where each person left off

Opening a source's browser SHALL return each person to the database and
schema they last had open there.

#### Scenario: The browser opens on the last schema

```gherkin
Given the user last browsed the schema "main" of the database "stock"
When the user opens the source again
Then the browser opens on the schema "main" of "stock"
```

### Requirement: A database's table list is kept until refreshed

A database's list of tables SHALL be kept after it is first read, saying when
it was read, and SHALL be read again only when someone asks for a refresh,
because reading a large warehouse can take a minute.

#### Scenario: A table added since shows after a refresh

```gherkin
Given the table list of "sales" was read before the table "regions" was added
When the user refreshes the table list of "sales"
Then "regions" is listed
```

### Requirement: Connect a MotherDuck warehouse with the instance's token

MotherDuck is a cloud warehouse. A token, a long secret string, signs in to
it and decides which databases can be read. An instance has one MotherDuck
token, set when it is deployed, and everything in Featherbase uses it. A System
Manager SHALL be able to connect a MotherDuck warehouse without handling the
token. They SHALL be told who the token signs in as and how many databases it
can read, or be given a plain reason why it cannot be used.

#### Scenario: The token's owner and databases show

```gherkin
Given the user is a System Manager
And the instance's token can read five databases
When the user starts connecting a MotherDuck warehouse
Then they are told who the token signs in as and that it can read five databases
And they are not asked for a token
```

#### Scenario: A refused token is explained, not echoed

```gherkin
Given the user is a System Manager
And MotherDuck refuses the instance's token
When the user starts connecting a MotherDuck warehouse
Then they are told the token was refused, in plain words
And the message does not contain the token
```

#### Scenario: An instance with no token says so

```gherkin
Given the user is a System Manager
And the instance has no MotherDuck token
When the user starts connecting a MotherDuck warehouse
Then they are told the instance has no MotherDuck token
And no database is offered
```

### Requirement: A MotherDuck warehouse is only ever read

Featherbase SHALL only read a MotherDuck warehouse, with no setting that could
change this, even when the instance's token has write rights.

#### Scenario: A token with write rights still cannot change the warehouse

```gherkin
Given the instance's token can also write to the warehouse
And a table connected from its database "sales"
When the user tries to change a row of that table
Then the change is refused
And the row in the warehouse is unchanged
```

### Requirement: Reading a warehouse does not hold up a deploy

A copy, manual or scheduled, SHALL read the warehouse without keeping the apps busy, however long the read takes. It SHALL hold them only while it applies the rows, as one all-or-nothing step.

#### Scenario: A deploy during a slow warehouse read

- **WHEN** a deploy starts while a copy is still reading the warehouse
- **THEN** the deploy goes ahead, and the copy applies its rows afterwards

#### Scenario: The owning app is upgraded during the read

- **WHEN** the app that owns a copied Table is upgraded while the copy is reading the warehouse
- **THEN** the copy is refused with a message to try again, and no row changes

#### Scenario: The data source's settings change during the read

- **WHEN** a deploy changes the data source's settings while the copy is reading it
- **THEN** the copy is refused with a message to try again, and no row changes

### Requirement: A refresh leaves unchanged rows alone

A row whose copied values have not changed SHALL NOT be rewritten by Copy again or a scheduled refresh: its last-updated time stays, and it does not move in a list ordered by it. It runs no automations. It is still counted as unchanged in the run's report, and the run still appears in Past imports.

#### Scenario: Nothing changed in the warehouse

- **WHEN** the user copies again and the warehouse has not changed
- **THEN** the report says every row is unchanged, and no row's last-updated time moved

#### Scenario: The warehouse now agrees with a person's correction

- **WHEN** the warehouse changes to the value a person had corrected a row to, and later changes back
- **THEN** the first refresh closes any open disagreement on that value, and the second raises a new one

### Requirement: A copy refuses whole numbers it cannot hold exactly

A copy or Copy again SHALL refuse the whole run when a whole-number column meets a value beyond ±9,007,199,254,740,991. The refusal SHALL name the column, the value and the row, and no row SHALL change. Values inside that range SHALL copy as numbers.

#### Scenario: A BIGINT past the exact range

- **WHEN** a System Manager copies a warehouse table whose BIGINT column holds 9007199254740993 in one row
- **THEN** the copy is refused with a message naming that column, the value and the row, and no Table is created

#### Scenario: Copy again meets one later

- **WHEN** a copied table's source later holds such a value and Copy again runs
- **THEN** Copy again is refused the same way and the copied rows are unchanged

### Requirement: The deleted-at-source marker keeps its name while the Table is copied

While a Table is copied from a data source, the system SHALL refuse to rename or remove its deleted-at-source marker column, so Copy again keeps working.

#### Scenario: Renaming or removing the marker

- **WHEN** a System Manager renames or removes the deleted-at-source column of a copied Table
- **THEN** the change is refused with a message that the column marks rows deleted at the source, and Copy again still works

### Requirement: A source on an engine Featherbase no longer supports says so

A data source saved on an engine Featherbase no longer supports SHALL be refused wherever it is used, naming the engine and saying to delete the source, rather than failing as an unknown engine. MySQL is such an engine.

#### Scenario: A MySQL source saved before support ended

```gherkin
Given a data source "legacy-shop" was saved with the engine "mysql"
When the user tests "legacy-shop"
Then the test is refused, saying MySQL is no longer a supported data source and to delete "legacy-shop"
```
