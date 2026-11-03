# External Data Sources

## MODIFIED Requirements

### Requirement: Connect a data source

A builder with System Manager authority SHALL be able to register a data
source — a Postgres or MySQL database, a DuckDB warehouse, or a folder of
CSV files — naming where its connection details are kept rather than typing
them in, except a MotherDuck warehouse, whose token is pasted in the app;
those details are never stored in the open, shown back, or written to a log.
Only a System Manager can register or manage a data source.

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

### Requirement: Browse what a data source holds

Opening a data source SHALL let a System Manager see its tables and the
columns each one has, with a type Featherbase proposes for each column. A
database table with no single column that uniquely identifies each row SHALL
be shown as unusable for connecting, saying why. A warehouse declares no such
column for any table, so a warehouse table SHALL be browsable all the same:
the user can search all its tables within a database and schema, then preview
a chosen table's size, columns and first rows.

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

## ADDED Requirements

### Requirement: Connect a MotherDuck warehouse by pasting its token

MotherDuck is a cloud warehouse. A token, a long secret string, signs in to
it and decides which databases can be read; a read scaling token is one that
can only read. A System Manager SHALL be able to connect a MotherDuck
warehouse by pasting its token and testing it, with no setup on the server.
The test SHALL say who the token signs in as and how many databases it can
read, warn when the token can also write, or give a plain reason why it
failed.

#### Scenario: The token's owner and databases show

```gherkin
Given the user is a System Manager
When the user tests a working token that can read five databases
Then they are told who the token signs in as and that it can read five databases
```

#### Scenario: A refused token is explained, not echoed

```gherkin
Given the user is a System Manager
When the user tests a token that MotherDuck refuses
Then they are told the token was refused, in plain words
And the message does not contain the token
```

#### Scenario: A token that can write is flagged

```gherkin
Given the user is a System Manager
When the user tests a working token that can also write to the warehouse
Then the test succeeds, with a warning to use a read scaling token instead
```

### Requirement: Choose which databases a warehouse source reads

After a successful test, the System Manager SHALL choose which databases the
source reads, from the account's own databases and those shared with it, and
at least one must be chosen. Only the chosen databases are offered for
browsing.

#### Scenario: Only the two ticked databases appear

```gherkin
Given a token that can read five databases, among them "sales" and "stock"
When the user ticks "sales" and "stock" and saves the source
Then browsing the source offers "sales" and "stock" and no other database
```

#### Scenario: Saving stays blocked until a database is ticked

```gherkin
Given a token that has passed its test
When the user has ticked no database
Then the source cannot be saved
```

### Requirement: A pasted token stays secret

A pasted token SHALL be kept encrypted, and once saved SHALL never be shown,
returned or written to a log again; the source shows only its last four
characters.

#### Scenario: Only the token's last four show

```gherkin
Given a MotherDuck source saved with a token ending in "4f2a"
When the user opens the source
Then they see that a token is saved, ending in "4f2a"
And the rest of the token appears nowhere on the page
```

### Requirement: A warehouse token can be replaced

A System Manager SHALL be able to replace a MotherDuck source's token at any
time; the new token is tested before it is saved.

#### Scenario: The new token's last four show

```gherkin
Given a MotherDuck source saved with a token ending in "4f2a"
When the user replaces it with a working token ending in "9c1e"
Then the source shows a token ending in "9c1e"
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
identity so the next copy still updates the same native rows.

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
