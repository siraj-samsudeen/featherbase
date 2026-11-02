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
its schema, then the table, then a preview of how many rows and columns it
has and its first rows.

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
