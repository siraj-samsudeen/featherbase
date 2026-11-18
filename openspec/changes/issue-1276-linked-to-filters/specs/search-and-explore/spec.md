## ADDED Requirements

### Requirement: A list follows its links with Linked to filters

A list's Add filter SHALL offer Linked to…: pick a Table the list's rows are linked to (by their
links, by its links back to them, through a link Table or a sub-table), then rows of it, searchable,
each showing how many rows it is linked to; none picked means any of them. A step MAY be linked on
to another Table, and each step SHALL show how many of its rows match.

#### Scenario: The lines of one supplier's orders

```gherkin
Given Acme has two purchase orders with lines of 100, 150 and 100, and Bolt Co one order with a line of 999
When the user lists the PO Lines linked to Purchase Orders linked to the supplier Acme
Then the list shows Acme's three lines with a total of 350
And the Purchase Order step counts 2
```

### Requirement: Not linked to keeps the rows linked to none

Add filter SHALL offer Not linked to…, built like Linked to, keeping the rows linked to none of the
chosen rows; a row whose link is empty is not linked.

#### Scenario: Suppliers with no order

```gherkin
Given Acme has two purchase orders, Bolt Co one, and Cord Ltd none
When the user lists the Suppliers not linked to any Purchase Order
Then the list shows only Cord Ltd
```

### Requirement: A linked filter is an ordinary filter that respects reading access

A Linked to or Not linked to filter SHALL be kept in the list's address and its saved views like any
other filter, and the list SHALL show the exact total of its money column over every row the filters
keep. A row the viewer may not read SHALL never be counted or matched, at any step.

#### Scenario: Another reader's orders never count

- **WHEN** a reader who may read only their own purchase orders lists Suppliers linked to any
  Purchase Order
- **THEN** a supplier linked only by orders they may not read is not in the list, and no count
  includes those orders

### Requirement: An old Explore link opens the filtered list

Explore SHALL be retired. An Explore address SHALL open the list of the last Table its chain
reached, filtered by Linked to steps back to the rows it had picked; an address with no starting
Table SHALL open All tables, and one naming what no longer exists SHALL open as much as still
resolves.

#### Scenario: A shared Explore link

```gherkin
Given Acme has two purchase orders with lines of 100, 150 and 100, and Bolt Co one order with a line of 999
When the user opens an Explore link from Supplier through Purchase Order to PO Line with Acme picked
Then the list of PO Lines shows Acme's three lines
```

## REMOVED Requirements

### Requirement: Explore chains tables and narrows them as you click

**Reason**: Explore is retired (#1276); the list's Linked to filters build the same chains.
**Migration**: "A list follows its links with Linked to filters"; old links follow "An old Explore
link opens the filtered list".

### Requirement: An Explore chain can be shared and reopened

**Reason**: Explore is retired; a Linked to filter lives in the list's address like any filter.
**Migration**: "An old Explore link opens the filtered list".

### Requirement: Open the last related row in place

**Reason**: Explore is retired; a list's rows open in its record panel.
**Migration**: The list's record panel (record-workspace).

### Requirement: Find the starting table by typing

**Reason**: Explore is retired; the search bar and All tables find a Table.
**Migration**: Admin UI Feedback's search bar.

### Requirement: Explore shows a linked row by its title

**Reason**: Explore is retired; a list's links read by their names (list-view).
**Migration**: list-view's "A link in a list reads as the linked row's name".
