# List View

## ADDED Requirements

### Requirement: See every row of a table as a tree

From a list, the user SHALL be able to see every row of the table as a tree: one folded line per
row, each unfolding in place into what it links to and what links to it.

#### Scenario: Every site, folded

```gherkin
Given there are four sites, among them Enchakkal
When the user opens the list of sites as a tree
Then the four sites show folded, one line each
And unfolding Enchakkal shows its region and its group of plants
```

## MODIFIED Requirements

### Requirement: A link in a list reads as the linked row's name

A list cell that links to another table's row SHALL show that row's title,
not its id alone. Where the row's id is a code people use, not a generated id,
the code SHALL follow the name ("Globex Ltd · cust-1"). Clicking the link SHALL
open that row in the drill pane beside the list, not move away from the list.
A linked row the user may not read SHALL show neither its title nor its id.

#### Scenario: The Widgets order's customer reads "Globex Ltd"

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens the orders list
Then the user sees the customer of the order "Widgets" as "Globex Ltd · cust-1"
```

#### Scenario: Globex Ltd opens from an order

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user opens the orders list and clicks the customer of the order "Widgets"
Then the user sees the customer "Globex Ltd" in the drill pane beside the orders list
```
