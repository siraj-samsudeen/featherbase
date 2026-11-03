# Dashboards and Home Pages

## MODIFIED Requirements

### Requirement: Resume where you left off

The home page SHALL offer one-click tiles back to the user's newest usable row and view and last search, subject to current destination validation described in Search and Explore. A kind with no usable candidate SHALL have no tile; when there are no candidates the resume section SHALL be omitted.

#### Scenario: Tiles back to what the user was just doing

```gherkin
Given the user opened a readable row, then a readable list, then ran a search
When the user returns to a home page
Then a tile back to each of the three is offered after successful destination validation
```

#### Scenario: No usable rows leaves only the other kinds

```gherkin
Given the user's only visited row is the Plant row "North depot"
And the user also visited Supplier and searched for "depot"
And "North depot" has been deleted
When the user opens a home page
Then no row tile is offered
And Supplier and the search for "depot" remain available
```

#### Scenario: No usable destinations leaves no resume section

```gherkin
Given the user's only visits are to Plant and its row "North depot"
And Plant has been deleted
When the user opens a home page
Then no resume section is offered
And personal activity remains visible
```
