# Spreadsheet Import

## ADDED Requirements

### Requirement: A column switched to Choice takes its options from the sheets

A column the user switches to Choice SHALL take as its options every different value in the sheets feeding it, however many there are, and a value with spaces around it SHALL import as that option. A long list shows its first eight options and how many more, with the whole list on hover.

#### Scenario: Many sections become a Choice by hand

```gherkin
Given a sheet whose Section column holds 12 different values
When the user imports it as a new table with Section switched to Choice
Then the new table holds every row
And its Section column offers all 12 values
```

#### Scenario: A long list of options stays readable

```gherkin
Given a sheet whose Section column holds 12 different values
When the user switches Section to Choice in the import wizard
Then the wizard shows the first 8 options and says 4 more
```

#### Scenario: Spaces around a value don't refuse its row

```gherkin
Given a sheet whose Zone column repeats Dairy and Fresh with spaces around them
When the user imports it as a new table
Then the new table holds every row
```

### Requirement: A refused table says why

When the server refuses a table the import would make, the wizard SHALL show the server's reason, naming the column by the label the user sees where it can, not only that the definition is invalid.

#### Scenario: A column with a bad name is named

```gherkin
Given a sheet with a Zone column
When the user imports it as a new table with Zone's column name changed to "Bad Name"
Then the import says the table failed because Column "Zone" must be snake_case
```

### Requirement: Refused rows on a one-sheet import stay on screen

A one-sheet import with any refused row SHALL stay on the wizard and report the refused rows. An import with none still goes straight to the table's list.

#### Scenario: Every row is refused

```gherkin
Given a sheet whose Zone column holds only words
When the user imports it as a new table with Zone switched to Int
Then the wizard stays open and reports the rows as failed
```

### Requirement: Trying again after a dropped connection

If the connection drops after an import has made its new table, importing again SHALL work when no row landed, using the columns as they are now. When rows landed it SHALL refuse, saying how many and where to undo them, so that they are not doubled.

#### Scenario: No row landed

```gherkin
Given a sheet with a Zone column
And the connection drops while the import is sending its rows
When the user imports it as a new table
Then the import says the table failed
When the connection is back and the user imports again
Then the new table holds every row
```

#### Scenario: Some rows landed

```gherkin
Given a sheet with a Zone column
And the connection drops after one row has landed
When the user imports it as a new table
Then the import says the table failed
When the connection is back and the user imports again
Then the import says the table already holds 1 row and to undo it under Past imports
And the new table holds 1 row
```
