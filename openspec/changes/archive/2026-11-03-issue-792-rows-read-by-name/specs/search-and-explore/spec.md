# Search and Explore

## ADDED Requirements

### Requirement: A link in the relationship map's row lists reads by its title

In the rows the relationship map lists, a cell that links to another row SHALL
show that row's title, not its id, wherever the user may read it, and
clicking it SHALL move the map to that row.

#### Scenario: Paint the fence's assignee reads "Asha"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map
Then the user sees "Paint the fence" listed as assigned to "Asha"
```

#### Scenario: Clicking Asha moves the map to her

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map and clicks "Asha" in the listed row
Then the user sees the map centered on "Asha"
```
