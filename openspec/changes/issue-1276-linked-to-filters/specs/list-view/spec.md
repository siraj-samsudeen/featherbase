## ADDED Requirements

### Requirement: A link cell offers Go there and Filter

Every link cell in a list's table SHALL offer, on hover or keyboard focus, Go there (open the
linked row's own page, as a step on the path) and Filter (narrow the list to rows linked to that
same row), the same two actions the record panel's link chips offer. A link to a row the viewer may
not read SHALL offer neither.

#### Scenario: Filter by a cell's vehicle

- **WHEN** the user hovers an accident's vehicle "Truck 2" and chooses Filter
- **THEN** the list shows only accidents of Truck 2, with the filter as a chip

#### Scenario: Go to a cell's vehicle

- **WHEN** the user hovers an accident's vehicle "Truck 2" and chooses Go there
- **THEN** Truck 2's own page opens, and Back returns to the list

## MODIFIED Requirements

### Requirement: A picked link filter reads by the row's name

Once a linked row is picked, its quick filter SHALL show that row's name, not
its id, and so SHALL the filter as shown in use and in the list's recent
filters. An exact filter SHALL read as the path bar names it, its column then
the row's name: "Site: Bayside" (#1276).

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
Then the user sees the filter in use reading "Customer: Globex Ltd"
```

#### Scenario: The recent filter names Globex Ltd

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
And the orders list filtered to the customer "Globex Ltd"
When the user comes back to the whole orders list
Then the user sees a recent filter reading "Customer: Globex Ltd"
```

### Requirement: A filter names its column as the list does

A filter, as shown in use and in the list's recent filters, SHALL name its
column the way the list's heading does, not by the column's internal name.

#### Scenario: The filter in use names the Item column

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens a link to the orders list filtered to the item "Widgets"
Then the user sees the filter in use reading "Item: Widgets"
```
