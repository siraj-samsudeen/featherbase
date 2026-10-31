# Tables and Fields

## ADDED Requirements

### Requirement: A new table's list starts with its first seven columns

A new table, whether built by typing its columns or imported from a file, SHALL start with its
first seven columns in its list: the columns everyone sees when they open it. Whoever creates
the table can switch any column in or out, or all of them at once, before creating it.

#### Scenario: An imported Section Mapping lists its first seven columns

```gherkin
Given a sheet with the columns Section, MCH, Floor, Zone, Rack, Owner, Category, Remarks, Updated By and Notes
When the user imports it as a new table "Section Mapping" without changing which columns are in the list
Then the list of "Section Mapping" shows Section, MCH, Floor, Zone, Rack, Owner and Category
And Remarks, Updated By and Notes show only on each row's form
```

#### Scenario: A typed table starts the same way

```gherkin
Given the user is building a table by typing the same ten columns
When the user creates it without changing which columns are in the list
Then its list shows Section, MCH, Floor, Zone, Rack, Owner and Category
```

#### Scenario: A column left out of the import makes room for the next

```gherkin
Given the same ten-column sheet
When the user leaves MCH out and imports it as a new table
Then MCH is not in the list
And Remarks is in the list as the seventh column
```

#### Scenario: All ten in one go

```gherkin
Given the same ten-column sheet
When the user switches every column into the list at once and imports it as a new table
Then the list shows all ten columns
```

### Requirement: Change which columns a table's list shows

A System Manager SHALL be able to switch any of a table's existing columns into or out of its
list at any time, for everyone. No row changes.

#### Scenario: Remarks shows for everyone

```gherkin
Given the table "Section Mapping" with Remarks not in its list
When a System Manager switches Remarks into its list
Then a colleague opening the list of "Section Mapping" sees Remarks
And no row's values have changed
```

## MODIFIED Requirements

### Requirement: Shaping a table requires the builder authority

Creating a table, adding or renaming its columns, choosing which columns its list shows for
everyone, and changing how its rows are identified SHALL all require the same authority:
System Manager. A table the platform itself depends on SHALL NOT have its columns changed this
way at all.

#### Scenario: A platform table's columns are closed to editing

```gherkin
Given a table the platform depends on
When a builder opens its Columns screen
Then it says the table's columns belong to the platform
And it offers no way to add or rename one
```

#### Scenario: Only a System Manager changes the list for everyone

```gherkin
Given the user is not a System Manager
When the user opens the list of "Section Mapping"
Then the user can change which columns they see themselves
And nothing there changes the list for anyone else
```
