# External Data Sources

## ADDED Requirements

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
