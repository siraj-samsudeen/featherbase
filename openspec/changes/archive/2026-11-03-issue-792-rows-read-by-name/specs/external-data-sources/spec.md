# External Data Sources

## MODIFIED Requirements

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
