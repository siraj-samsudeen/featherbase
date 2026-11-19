## REMOVED Requirements

### Requirement: A quiet tip teaches a shortcut
**Reason**: Its example, collapsing the sidebar, no longer teaches by a tip (the owner, 18-Nov-2026). The rule stays, with search as its example, in "A quiet tip teaches a key the user has not tried".
**Migration**: None: what each person has learnt is kept as it was.

## MODIFIED Requirements

### Requirement: Featherbase reminds a user who forgets

Featherbase SHALL keep noticing how the user does each thing. If a user who has used a shortcut goes back to the mouse for it three times in a row, at least a day after they last used the key, Featherbase SHALL show a reminder that says so, and the list of shortcuts SHALL show that shortcut as slipping.

#### Scenario: Going back to the mouse a day later

```gherkin
Given the user opened search with its key two days ago
When the user opens search from the sidebar's search field three times in a row
Then a reminder says they have used the mouse three times since they last used the key
And the list of shortcuts shows opening search as slipping
```

## ADDED Requirements

### Requirement: A quiet tip teaches a key the user has not tried

After the user has done something three times in a row with the mouse that has a shortcut they have never used, Featherbase SHALL show one small tip naming the key. A tip SHALL never block the page, and each tip the user ignores SHALL double the number of mouse uses before the next one.

#### Scenario: Opening search by mouse three times

```gherkin
Given the user has never opened search with its key
When the user opens search from the sidebar's search field three times in a row
Then a tip names the key for opening search
```

### Requirement: The sidebar's key is named on hover, never in a tip

Collapsing or expanding the sidebar SHALL never bring up a tip or a reminder: its control names its key whenever the pointer rests on it. The list of shortcuts SHALL still show how the user collapses the sidebar, by key or by mouse.

#### Scenario: Collapsing the sidebar by mouse brings no tip

```gherkin
Given the user has never collapsed the sidebar with its key
When the user collapses or expands the sidebar with the mouse three times in a row
Then no tip appears
And the list of shortcuts shows collapsing the sidebar as not tried yet
```
