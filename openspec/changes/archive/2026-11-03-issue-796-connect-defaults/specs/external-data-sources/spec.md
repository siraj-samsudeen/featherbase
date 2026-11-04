# External Data Sources

## ADDED Requirements

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

Beside each row's ID, a connected table's list SHALL show its title and up
to four more of its columns, in the source's order. It leaves out the columns
that only record when a row was created or changed, and by whom.

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
