# External Data Sources

## ADDED Requirements

### Requirement: An app can choose how each table it connects reads

An app that connects a data source's tables SHALL be able to give each one its
name, its title, and the columns its list shows.

#### Scenario: The app's shelf shows as "East"

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a shelf labelled "Top" in the "East" aisle
And an app that connects its shelf table as "Shelf", titled by its aisle and listing only its aisle
And the app is installed
When the user opens that shelf
Then the user sees the shelf as "East"
```

#### Scenario: The app's shelf list shows only the aisle

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a shelf labelled "Top" in the "East" aisle
And an app that connects its shelf table as "Shelf", titled by its aisle and listing only its aisle
And the app is installed
When the user opens the list of shelves
Then the user sees each shelf's aisle
And the user does not see each shelf's label
```

### Requirement: An app can leave a table's columns out

An app SHALL be able to name columns of a table it connects to leave out, so no
one on an instance using the app can see them.

#### Scenario: The shelf's label is nowhere to be seen

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And a shelf labelled "Top" in the "East" aisle
And an app that connects its shelf table as "Shelf", titled by its aisle, listing only its aisle, and leaving out its label
And the app is installed
When the user opens that shelf
Then the user does not see "Top"
```

### Requirement: An app naming a column a table can't offer is not installed

An app that names, for a table it connects, a column the table does not have,
or a column it also leaves out, SHALL NOT be installed, and none of its tables
are connected. A misspelt name therefore never lets a column through.

#### Scenario: A misspelt column stops the app installing

```gherkin
Given the user is a System Manager
And a Postgres database of shelves and the bins on each shelf
And an app that connects its shelf table as "Shelf", titled by its aisle, listing only its aisle, and leaving out its colour
When the user installs the app
Then the app is not installed
And the user is told the shelf table has no column "colour"
And no table called "Shelf" is in Featherbase
```
