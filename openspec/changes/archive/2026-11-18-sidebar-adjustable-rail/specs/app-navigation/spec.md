## ADDED Requirements

### Requirement: The sidebar keeps the signed-in person's choices

The sidebar's collapsed choice and width SHALL be those of the signed-in person, the one at the keyboard, even while they view as someone else.

#### Scenario: Viewing as someone keeps the tester's own sidebar

```gherkin
Given a tester keeps the sidebar collapsed
And the person they view as has never collapsed it
When the tester views Dash as that person
Then Dash's navigation shows only its icons
And its foot holds the account, Help and Theme within the rail
When the tester expands the sidebar
Then Dash's navigation is shown in full
And the person viewed still has no choice of their own
```

### Requirement: The sidebar is as wide as the person makes it

Open, the sidebar's edge SHALL drag its width between 200 and 360 pixels, remembered for the person in that browser across applications as the collapsed choice is. A click on the edge SHALL fold it.

#### Scenario: The sidebar is as wide as the person makes it

```gherkin
Given the user has Dash open with its navigation in full
When the user drags the sidebar's edge 60 pixels to the right
Then the sidebar is 300 pixels wide
When the user drags the edge far to the right
Then the sidebar is 360 pixels wide
When the user opens Tasker
Then Tasker's sidebar is 360 pixels wide too
When the user clicks the sidebar's edge
Then Tasker's navigation shows only its icons
```

### Requirement: The rail keeps every control, each named on hover

Folded to its rail, the sidebar SHALL keep every control of its top and foot. Each SHALL be named when the pointer rests on it, and the collapse control SHALL name its key there, open or folded, instead of showing the key on the control. The sidebar's menus and these names SHALL show above the page.

#### Scenario: The collapse control names its key on hover

```gherkin
Given the user has Dash open with its navigation in full
When the user rests the pointer on the collapse control
Then a label reads "Collapse sidebar · Ctrl+B"
And the control itself shows no key
When the user folds the sidebar and rests the pointer on the control
Then a label reads "Expand sidebar · Ctrl+B"
```
