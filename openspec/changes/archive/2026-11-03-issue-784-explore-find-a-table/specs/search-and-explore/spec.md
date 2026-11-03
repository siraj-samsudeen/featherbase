# Search And Explore

## ADDED Requirements

### Requirement: Find the starting table by typing

In Explore, the user SHALL be able to type words from a table's name, in any
case, to narrow the tables to start from to those whose name holds every
word, and press Enter to start from the first match.

#### Scenario: Explore opens on the purchases

```gherkin
Given the user is a System Manager
And a table of suppliers and a table of purchases, each purchase from a supplier
When the user types "purch" in Explore's table search and presses Enter
Then Explore starts from the purchases
```

### Requirement: Explore shows a linked row by its title

A row in Explore SHALL show each row it links to by that row's title (the
value that names it, such as a supplier's name) rather than its id, wherever
the user may read that title.

#### Scenario: Each purchase shows its supplier "Acme"

```gherkin
Given the user is a System Manager
And a table of suppliers and a table of purchases, each purchase from a supplier
And the purchases are from the supplier "Acme"
When the user types "purch" in Explore's table search and presses Enter
Then each purchase shows "Acme"
```
