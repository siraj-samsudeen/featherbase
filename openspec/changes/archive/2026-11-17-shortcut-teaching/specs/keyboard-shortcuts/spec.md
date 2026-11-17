## ADDED Requirements

### Requirement: Shortcuts are visible where they work

A control that has a keyboard shortcut SHALL name its key when the user rests the pointer on it, and the user SHALL be able to open a list of the shortcuts on the page they are on. While that list is open, every control on screen that has a shortcut SHALL show its key next to it.

#### Scenario: Looking up the page's shortcuts

```gherkin
Given the user is on an Admin page with the sidebar
When the user opens the list of keyboard shortcuts
Then the list includes collapsing the sidebar with its key
And the sidebar's control shows that key next to it
```

### Requirement: A quiet tip teaches a shortcut

After the user has done something three times in a row with the mouse that has a shortcut they have never used, Featherbase SHALL show one small tip naming the key. A tip SHALL never block the page, and each tip the user ignores SHALL double the number of mouse uses before the next one.

#### Scenario: Collapsing the sidebar by mouse three times

```gherkin
Given the user has never collapsed the sidebar with its key
When the user collapses or expands the sidebar with the mouse three times in a row
Then a tip names the key for collapsing the sidebar
```

### Requirement: Featherbase reminds a user who forgets

Featherbase SHALL keep noticing how the user does each thing. If a user who has used a shortcut goes back to the mouse for it three times in a row, at least a day after they last used the key, Featherbase SHALL show a reminder that says so, and the list of shortcuts SHALL show that shortcut as slipping.

#### Scenario: Going back to the mouse a day later

```gherkin
Given the user collapsed the sidebar with its key two days ago
When the user collapses or expands the sidebar with the mouse three times in a row
Then a reminder says they have used the mouse three times since they last used the key
And the list of shortcuts shows collapsing the sidebar as slipping
```

### Requirement: Tips can be quieted for a while, never for good

The user SHALL be able to quiet tips: for a week the first time, a month the second, then three months each time after. Tips SHALL come back on their own when the time is up, and the user can bring them back sooner.

#### Scenario: Quieting tips twice

```gherkin
Given the user quieted tips once before
When the user quiets tips from a tip on 17-Nov-2026
Then no tip appears until 17-Dec-2026
```

### Requirement: What a user has learnt follows them

What the user has learnt SHALL be kept with their account, so it is the same on any device they sign in from.

#### Scenario: Signing in on another computer

```gherkin
Given the user collapsed the sidebar with its key on one computer
When the user signs in on another computer and opens the list of keyboard shortcuts
Then collapsing the sidebar shows as in use
```
