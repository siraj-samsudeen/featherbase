# app-navigation Specification

## Purpose
People move between the applications they can access and Featherbase through
consistent navigation, while keeping each application's own work and selection
state intact.

## Requirements

### Requirement: Change applications from the shared navigation

The user SHALL change between accessible applications and Featherbase through the existing application-name dropdown on both Tasker and Dash, without a separate administration control or duplicate platform link. Unavailable applications and destinations the user cannot access SHALL NOT be offered.

#### Scenario: Featherbase is a destination alongside the applications

```gherkin
Given the user can open Featherbase, Tasker and Dash
When the user chooses Featherbase from Tasker's application name
Then Featherbase opens
And no separate administration control is offered on Tasker
```

#### Scenario: A reader sees only accessible destinations

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user opens the application choices in Dash
Then Tasker and Dash are offered
But Featherbase is not offered
```

### Requirement: Applications share app-focused navigation

Tasker and Dash SHALL each use one app-focused sidebar with Featherbase's shared navigation presentation rather than competing platform menus. Tasker SHALL retain its task views, counts and project navigation; Dash SHALL retain its store selection alongside the application choice and its report destination in the shared navigation.

#### Scenario: Tasker keeps its project work

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
And Tasker has a project named September stock review with two tasks
When the user opens September stock review through the shared navigation
Then the project's two tasks are shown
And the shared navigation identifies September stock review as current
```

#### Scenario: Dash keeps the selected store

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
And the user has selected Lakeside in Dash
When the user opens the report through the shared navigation
Then Lakeside remains selected
And Dash shows the report state for Lakeside
```

### Requirement: Every page shares one sidebar chrome

Featherbase Admin, the account pages and every app SHALL share one chrome, the sidebar, with no top bar beside it on a wide window. Its top SHALL hold the application switcher and its foot the account. Every sidebar SHALL collapse to a rail of its icons by its own control or `Ctrl+B` / `Cmd+B`, never while the user types in a field, remembered per person in that browser across applications. At phone width it SHALL be a drawer opened from a slim header holding only its menu button.

#### Scenario: The sidebar collapses the same way in every application

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user presses Ctrl+B in Tasker
Then Tasker's navigation shows only its icons
When the user opens Dash
Then Dash's navigation shows only its icons too
When the user expands the sidebar from the sidebar itself
Then Dash's navigation is shown in full
```

#### Scenario: Typing keeps the shortcut for the field

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user presses Ctrl+B while typing in Tasker's search
Then Tasker's navigation stays shown
```

#### Scenario: The account pages carry the application switcher

```gherkin
Given the user can open Tasker and Dash but cannot open Featherbase
When the user opens Sign-in methods from Dash's account menu
Then the application name shows Dash
And Tasker is offered beside it
```

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

Open, the sidebar's edge SHALL drag its width between 200 and 360 pixels, remembered for the person in that browser across applications as the collapsed choice is. A click on the edge SHALL fold it. Folded, pulling the edge out of the rail SHALL open the sidebar at the width it is pulled to.

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
When the user pulls the rail's edge 200 pixels to the right
Then Tasker's navigation is shown in full, 256 pixels wide
```

### Requirement: The rail keeps every control, each named on hover

Folded to its rail, the sidebar SHALL keep every control of its top and foot. Each SHALL be named when the pointer rests on it, and the collapse control SHALL name itself in Title Case with its key there, open or folded ("Collapse Sidebar · ⌘B" on a Mac, Ctrl+B on Windows and Linux), instead of showing the key on the control. The sidebar's menus and these names SHALL show above the page.

#### Scenario: The collapse control names its key on hover

```gherkin
Given the user has Dash open with its navigation in full
When the user rests the pointer on the collapse control
Then a label reads "Collapse Sidebar · Ctrl+B"
And the control itself shows no key
When the user folds the sidebar and rests the pointer on the control
Then a label reads "Expand Sidebar · Ctrl+B"
```
