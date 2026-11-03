# Naming and Numbering

## ADDED Requirements

### Requirement: New tables number their rows 1, 2, 3

A new table SHALL number its rows 1, 2, 3 and so on, with no prefix and no
leading zeros, unless its maker chooses another way of naming them. Before the
table is created, its maker sees how its rows will be numbered.

#### Scenario: The first rows of a new table are 1, 2 and 3

```gherkin
Given the user creates a table "Plant" without choosing how its rows are named
When the user adds three plants
Then the plants are numbered 1, 2 and 3
```

#### Scenario: The builder shows the numbering before the table is made

```gherkin
Given the user is building a table "Plant"
Then the builder says its rows will be numbered 1, 2, 3
```

### Requirement: Each table keeps its own count

Each table SHALL count its own rows, so two tables numbered the same way never
take numbers from each other.

#### Scenario: Two tables with the same prefix both start at 001

```gherkin
Given two tables "Plant" and "Plant Copy" both named by a series with the prefix "PLANT-" and three digits
When the user adds a plant to each
Then each plant is numbered PLANT-001
```

### Requirement: A number already in the table is skipped

When the next number is already the id of one of the table's rows, for example
one an import brought in, the row SHALL get the next free number instead of
being refused.

#### Scenario: An imported row already holds the next number

```gherkin
Given a table "Plant" whose rows are numbered 1, 2, 3
And the user has added plant 1 and imported a plant with the id 2
When the user adds another plant
Then it is numbered 3
```
