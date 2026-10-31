## ADDED Requirements

### Requirement: A list shows the table's list columns

A table's list SHALL show the row ID followed by the table's list columns, the columns chosen
for everyone to see. The table's other columns are on each row's form.

#### Scenario: Section Mapping shows its seven list columns

```gherkin
Given the table "Section Mapping" whose list columns are Section, MCH, Floor, Zone, Rack, Owner and Category
When the user opens its list
Then the user sees the row ID and those seven columns
And Remarks shows only on a row's form
```

#### Scenario: A table with no list columns shows its first two

```gherkin
Given a table with no list columns
When the user opens its list
Then the user sees the row ID and the table's first two columns
```

### Requirement: Show or hide any column for yourself

The user SHALL be able to switch any column they may read on or off in their own view of a
list, and see which of them are the table's list columns. The change is only for them, on that
table.

#### Scenario: Remarks shows only for me

```gherkin
Given the table "Section Mapping" with Remarks not in its list
When the user switches on Remarks
Then the user's list shows Remarks
And a colleague's list of "Section Mapping" does not show Remarks
```

#### Scenario: Every column off leaves the row ID

```gherkin
Given the list of "Section Mapping"
When the user switches off every column
Then the user's list still shows each row's ID
```

### Requirement: A System Manager can make their view everyone's default

A System Manager SHALL be able to make the columns in their own view the table's list columns.
Each colleague's own choices still apply on top.

#### Scenario: My view becomes the default

```gherkin
Given a System Manager has switched on Remarks in the list of "Section Mapping"
And a colleague has never changed their own view of it
When the System Manager makes their view the default for everyone
Then the colleague's list shows Remarks
```

#### Scenario: A colleague's own choices hold

```gherkin
Given a colleague has switched off Floor and switched on Notes in the list of "Section Mapping"
When a System Manager makes a default that includes Floor and leaves out Notes
Then the colleague's list still shows Notes
And the colleague's list still does not show Floor
```

## MODIFIED Requirements

### Requirement: The list remembers how it's arranged

Sorting the list and choosing which columns show SHALL be remembered for that user on that
table, so returning to the list later — even after signing back in — shows it the same way.
This covers columns the user switched on as well as ones they switched off.

#### Scenario: Return after hiding a column

```gherkin
Given the user has hidden a column and sorted the list of a table
When the user later reopens the same table's list
Then the column is still hidden
And the list is still sorted the way they left it
```

#### Scenario: Remarks is still there next time

```gherkin
Given the user has switched on Remarks in the list of "Section Mapping"
When the user signs out, signs back in and reopens that list
Then Remarks still shows
```
