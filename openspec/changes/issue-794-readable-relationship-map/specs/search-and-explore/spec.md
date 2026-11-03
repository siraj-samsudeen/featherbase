# Search And Explore

## ADDED Requirements

### Requirement: The relationship map says how each row is related

Each linked row and related collection on the relationship map SHALL say
which Table it comes from and, in full and in the words the user knows the
link by, which link joins it to the row at the center, never a technical
name.

#### Scenario: A task's assignee reads "Assigned To"

```gherkin
Given the user is a System Manager
And a table of people and a table of tasks, each task assigned to a person
And the task "Paint the fence" assigned to "Asha", whose phone is "98400 12345"
When the user opens that task's relationship map
Then the user sees "Asha", a Person, linked by "Assigned To"
```

#### Scenario: Asha's tasks read by "Assigned To"

```gherkin
Given the user is a System Manager
And a table of people and a table of tasks, each task assigned to a person
And the task "Paint the fence" assigned to "Asha", whose phone is "98400 12345"
When the user opens Asha's relationship map
Then the user sees Asha's tasks related by "Assigned To"
```

### Requirement: The relationship map lists its center row until a collection is opened

Until the user opens a related collection, the relationship map SHALL list
the row at its center the way it lists an opened collection's rows, so that
row's own values are in view too.

#### Scenario: Asha is listed with her phone until her tasks are opened

```gherkin
Given the user is a System Manager
And a table of people and a table of tasks, each task assigned to a person
And the task "Paint the fence" assigned to "Asha", whose phone is "98400 12345"
When the user opens Asha's relationship map
Then the user sees "Asha" listed with her phone "98400 12345"
When the user opens Asha's tasks
Then the user sees "Paint the fence" listed instead of "Asha"
```
