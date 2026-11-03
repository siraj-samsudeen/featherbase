# List View

## MODIFIED Requirements

### Requirement: A list shows the table's list columns

A table's list SHALL lead with each row's title (the value that names it, such
as a customer's name), followed by the table's list columns, the columns
chosen for everyone to see. A table that names no title column, such as
Section Mapping, leads with the row ID instead. Every list of a table's rows,
such as one opened on the relationship map, leads the same way. The table's
other columns are on each row's form.

#### Scenario: The customers list leads with their names

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens the customers list
Then the user sees the list led by "Globex Ltd" and "Initech", without their row IDs
```

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
table. The column a list leads with always stays.

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

#### Scenario: Every column off leaves each customer's name

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user switches off every column of the customers list
Then the user sees the list led by "Globex Ltd" and "Initech", without their row IDs
```

### Requirement: A picked link filter reads by the row's name

Once a linked row is picked, its quick filter SHALL show that row's name, not
its id, and so SHALL the filter as shown in use and in the list's recent
filters.

#### Scenario: The customer filter reads "Globex Ltd"

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens a link to the orders list filtered to the customer "Globex Ltd"
Then the user sees the quick customer filter reading "Globex Ltd"
```

#### Scenario: The filter in use names Globex Ltd

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens a link to the orders list filtered to the customer "Globex Ltd"
Then the user sees the filter in use reading "Customer = Globex Ltd"
```

#### Scenario: The recent filter names Globex Ltd

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
And the orders list filtered to the customer "Globex Ltd"
When the user comes back to the whole orders list
Then the user sees a recent filter reading "Customer = Globex Ltd"
```

## ADDED Requirements

### Requirement: A filter names its column as the list does

A filter, as shown in use and in the list's recent filters, SHALL name its
column the way the list's heading does, not by the column's internal name.

#### Scenario: The filter in use names the Item column

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens a link to the orders list filtered to the item "Widgets"
Then the user sees the filter in use reading "Item = Widgets"
```

### Requirement: A link in a list reads as the linked row's name

A list cell that links to another table's row SHALL show that row's title,
not its id, and open that row. A linked row the user may not read keeps its
id.

#### Scenario: The Widgets order's customer reads "Globex Ltd"

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens the orders list
Then the user sees the customer of the order "Widgets" as "Globex Ltd"
```

#### Scenario: Globex Ltd opens from an order

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens the orders list and clicks the customer of the order "Widgets"
Then the user sees the customer "Globex Ltd"
```

### Requirement: A row with no name is never a blank

A row whose title is blank SHALL still read as something that tells it apart,
a few of its own values or else its table and id, wherever a list, the
relationship map's row lists or a filter shows it by name.

#### Scenario: A nameless customer is listed by its id

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
And a customer "cust-3" with no name, with the order "Bolts"
When the user opens the customers list
Then the user sees the customer "cust-3" listed by its id
```

#### Scenario: A nameless customer's order reads its id

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
And a customer "cust-3" with no name, with the order "Bolts"
When the user opens the orders list
Then the user sees the customer of the order "Bolts" read by its id "cust-3"
```
