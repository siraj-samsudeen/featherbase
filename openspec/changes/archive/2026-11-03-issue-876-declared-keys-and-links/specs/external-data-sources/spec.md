# External Data Sources

## ADDED Requirements

### Requirement: An app can say which column identifies a table's rows

An app that connects a table from a read-only data source whose source
declares no primary key SHALL be able to name the column that identifies each
row, and the table connects with that column as its key.

#### Scenario: A crate is found by its number

```gherkin
Given the user is a System Manager
And a Postgres database of crates on pallets that declares no keys or links
And a crate numbered 7 holding "Mangoes" on the pallet "P-1"
And an app that connects its crate table as "Crate", identified by its number
And the app is installed
When the user opens crate 7
Then the user sees the crate holds "Mangoes"
```

### Requirement: An app can say what a column links to

An app SHALL be able to say, for a column of a table it connects, which of the
source's tables it points at. The column then links to that table's rows by
their key, wherever Featherbase shows links, whichever of the two tables the
app connects first. A link that agrees with one the source declares is
accepted.

#### Scenario: A crate's pallet reads by its title

```gherkin
Given the user is a System Manager
And a Postgres database of crates on pallets that declares no keys or links
And a crate numbered 7 holding "Mangoes" on the pallet "P-1"
And an app that connects its crate and pallet tables, identified by their numbers, with each crate's pallet linking to the pallets
And the app is installed
When the user opens crate 7
Then the user sees the crate's pallet as "P-1"
```

#### Scenario: A link that agrees with the source's is accepted

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a bin on the shelf titled "Top"
And an app that connects its shelf table identified by its id and its bin table, with each bin's shelf linking to the shelves
And the app is installed
When the user opens a bin
Then the user sees the bin's shelf as "Top"
```

### Requirement: An app whose key or link the source can't honour is not installed

An app SHALL NOT be installed, and none of its tables connected, when a key it
declares differs from the key the source declares, or is declared on a data
source that can be written to; or when a link it declares differs from the
link the source declares, or points at a table the app can't connect: one the
source does not have or may not read, or one with no key from the source or
the app.

#### Scenario: A key that differs from the source's stops the app installing

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And an app that connects its shelf table as "Shelf", identified by its label
When the user installs the app
Then the app is not installed
And the user is told the shelf table is already identified by its id
And no table called "Shelf" is in Featherbase
```

#### Scenario: A link to a table the source lacks stops the app installing

```gherkin
Given the user is a System Manager
And a Postgres database of crates on pallets that declares no keys or links
And an app that connects its crate table as "Crate", identified by its number, with each crate's pallet linking to a table called "trolley"
When the user installs the app
Then the app is not installed
And the user is told the source has no table "trolley"
And no table called "Crate" is in Featherbase
```

#### Scenario: A link that differs from the source's stops the app installing

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And an app that connects its shelf and bin tables, with each bin's shelf linking to the bins
When the user installs the app
Then the app is not installed
And the user is told the bin's shelf already links to the shelves
And no table called "Shelf" is in Featherbase
```
