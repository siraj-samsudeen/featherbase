# Search And Explore

## ADDED Requirements

### Requirement: The relationship map says how each row is related

Each linked row and related collection on the relationship map SHALL say
which Table it comes from and, in full and in the words the user knows the
link by, which link joins it to the row at the center, never a technical
name.

#### Scenario: A chore's assignee reads "Assigned To"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens that chore's relationship map
Then the user sees "Asha", a Volunteer, linked by "Assigned To"
```

#### Scenario: Asha's chores read by "Assigned To"

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens Asha's relationship map
Then the user sees Asha's chores related by "Assigned To"
```

### Requirement: The relationship map lists its center row until a collection is opened

Until the user opens a related collection, the relationship map SHALL list
the row at its center the way it lists an opened collection's rows, so that
row's own values are in view too.

#### Scenario: Asha is listed with her phone until her chores are opened

```gherkin
Given the user is a System Manager
And a table of volunteers and a table of chores, each chore assigned to a volunteer
And the chore "Paint the fence" assigned to "Asha", whose phone is "555-0142"
When the user opens Asha's relationship map
Then the user sees "Asha" listed with her phone "555-0142"
When the user opens Asha's chores
Then the user sees "Paint the fence" listed instead of "Asha"
```
