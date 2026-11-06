## MODIFIED Requirements

### Requirement: A link in a list reads as the linked row's name

A list cell that links to another table's row SHALL read as links to that
table read, by its link format, never by a generated id, and open that row. A
linked row the user may not read reads as neutral words.

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
