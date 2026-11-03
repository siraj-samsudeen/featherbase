# List View

## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and
every filter added SHALL narrow the list further; each filter in use is
shown and can be removed on its own. A few of the list's own columns also
carry a quick filter above the list, for the filters used most.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it
  brings back every row

#### Scenario: Use a quick filter

- **WHEN** the user picks "Closed" in the quick filter above the list
- **THEN** only Closed rows show, and picking "All" brings every row back

## ADDED Requirements

### Requirement: Filter a list by a linked row's name

A list's quick filter for a column that links to another table's rows SHALL
let the user type part of a linked row's name and pick that row; the list
then shows only the rows linked to it. The filter only picks rows that exist;
it never offers to create one.

#### Scenario: Only Globex Ltd's orders show

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user types "Glo" into the orders list's quick customer filter and picks "Globex Ltd"
Then the user sees only the orders from "Globex Ltd"
```

#### Scenario: The customer filter offers no new customer

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user types "Glo" into the orders list's quick customer filter
Then the user is offered "Globex Ltd" and no way to create a customer
```

### Requirement: A picked link filter reads by the row's name

Once a linked row is picked, its quick filter SHALL show that row's name, not
its id.

#### Scenario: The customer filter reads "Globex Ltd"

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens a link to the orders list filtered to the customer "Globex Ltd"
Then the user sees the quick customer filter reading "Globex Ltd"
```

### Requirement: A picked link filter clears in one click

One click SHALL clear a picked link filter and bring every row back.

#### Scenario: Both customers' orders show again

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
And the orders list filtered to the customer "Globex Ltd"
When the user clears the quick customer filter
Then the user sees the orders from both "Globex Ltd" and "Initech"
```
