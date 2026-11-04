# List View

## ADDED Requirements

### Requirement: A compact list, remembered per table

A list SHALL show every one of its columns by default, and the user SHALL be able to switch it to
a compact layout that leads with each row's name and a few key values. The choice is remembered
for that user on that table.

#### Scenario: The sites list stays compact

```gherkin
Given the user switched the list of sites to its compact layout
When the user signs in again and opens the list of sites
Then Enchakkal shows by its name with a few key values
And the list of plants still shows all its columns
```

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
