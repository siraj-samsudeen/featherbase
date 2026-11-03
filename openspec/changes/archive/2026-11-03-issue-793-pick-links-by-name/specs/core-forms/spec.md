# Row Editing

## MODIFIED Requirements

### Requirement: Pick a linked row by typing

A field that links to another Table's rows SHALL offer matching rows as the
user types, found and shown by their title (the value that names a row, such
as a customer's name) whenever that Table names one, rather than by their id;
it fills the field with the one they pick, and offers a way to create a new
row to link to.

#### Scenario: Find a customer by a few letters

```gherkin
Given the user is a System Manager
And orders from the customers "Globex Ltd" and "Initech"
When the user types "Ltd" into a new order's customer and picks "Globex Ltd"
Then the user was offered only "Globex Ltd"
And the user sees the saved order's customer as "Globex Ltd"
```
