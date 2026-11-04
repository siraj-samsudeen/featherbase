# Relational Navigation

## Purpose

People check data by walking between related rows: a site, its plants, a plant's profit centres,
and back up to the region. Relational navigation lets them make that walk from any list or row
without losing their place. A **drill pane** shows one row's links in both directions next to
whatever the user is looking at; a **path** remembers every step so the user can go back, go
forward or share where they are.

## ADDED Requirements

### Requirement: See a row's links without leaving the list

Selecting a row in any list SHALL show it in the drill pane, next to the list: the row's name and
table, the rows it points at, and the groups of rows that point at it, each with a count.

#### Scenario: Enchakkal's plants are counted beside the site list

```gherkin
Given the site Enchakkal is in region Kerala and has three plants
When the user selects Enchakkal in the list of sites
Then the drill pane shows that Enchakkal points at the region Kerala
And it shows a group of 3 plants that point at Enchakkal
And the list of sites stays as it was
```

### Requirement: Following a link opens the linked row in the drill pane

Clicking a linked row's name, in a list or on a row page, SHALL show that row in the drill pane
instead of leaving the page.

#### Scenario: Kerala opens beside the site list

```gherkin
Given the site Enchakkal is in region Kerala
When the user clicks Kerala in Enchakkal's line of the list of sites
Then Kerala shows in the drill pane
And the list of sites stays as it was
```

### Requirement: Drill from row to row inside the pane

Clicking a row listed in the drill pane SHALL move the pane to that row, so the user can keep
walking without the list underneath changing. Opening that row's own page is a separate choice.

#### Scenario: From the site to its supermarket

```gherkin
Given the user has Enchakkal open in the drill pane
When the user opens its group of plants and clicks Enchakkal Supermarket
Then the drill pane shows Enchakkal Supermarket and what points at it
And the list of sites stays as it was
```

### Requirement: A group can be opened as its own list

A group in the drill pane SHALL list its rows, and the user SHALL be able to open the group as a
full list of that table, narrowed to the rows that point at the row in the pane.

#### Scenario: Enchakkal's plants as a list

```gherkin
Given the user has Enchakkal open in the drill pane
When the user opens its group of plants as a list
Then the list of plants opens, narrowed to the 3 plants of Enchakkal
```

### Requirement: Narrow the list from a linked value

From a value the row in the pane points at, the user SHALL be able to narrow the list underneath
to rows with the same value, when that list has such a column.

#### Scenario: Only Kerala's sites

```gherkin
Given the user has Enchakkal open in the drill pane over the list of sites
When the user narrows the list by Enchakkal's region Kerala
Then the list of sites shows only sites in Kerala
And the filter shows as one of the list's filters, which the user can remove
```

### Requirement: Read a row's fields in the pane

The drill pane SHALL show the row's fields read-only, grouped as on its form, with linked rows by
name. Empty fields are folded away under a count and long text is shortened until the user asks
for more. Editing happens on the row's form.

#### Scenario: Enchakkal's fields at a glance

```gherkin
Given the site Enchakkal has a long note and two empty fields
When the user reads Enchakkal's fields in the drill pane
Then the note is shortened with a way to read all of it
And the two empty fields are folded away under "2 empty fields"
And the user can open Enchakkal's form to edit it
```

### Requirement: The path remembers every step

Every drill and every filter SHALL become a step on a path, named after the rows and values it
shows. Choosing an earlier step SHALL bring back what was on screen at that step.

#### Scenario: Back to the site from a cost centre

```gherkin
Given the user narrowed the list of sites to Kerala, selected Enchakkal and drilled to Enchakkal Supermarket
When the user chooses the step named Enchakkal on the path
Then the drill pane shows Enchakkal again with the same group open
And the list of sites is still narrowed to Kerala
```

### Requirement: Back and forward walk the path

The path SHALL go back and forward one step at a time, and the browser's own back and forward
buttons SHALL walk the same steps.

#### Scenario: The browser's back button returns to Enchakkal

```gherkin
Given the user drilled from Enchakkal to Enchakkal Supermarket
When the user presses the browser's back button
Then the drill pane shows Enchakkal again
And going forward shows Enchakkal Supermarket again
```

### Requirement: A step can be shared as a link

Every step SHALL have its own link. Opening the link SHALL show the same rows, filters and open
groups, each named as the person opening it is allowed to read it.

#### Scenario: A colleague opens the supermarket step

```gherkin
Given the user copied the link of the step showing Enchakkal Supermarket
When a colleague who can read sites and plants opens that link
Then the colleague sees the list of sites narrowed to Kerala
And Enchakkal Supermarket in the drill pane
```

### Requirement: Go back to a recent path

The user SHALL be able to reopen any of their last ten paths, even after signing in again.

#### Scenario: Yesterday's walk is still there

```gherkin
Given the user walked from the list of sites to Enchakkal Supermarket yesterday
When the user signs in today and looks at their recent paths
Then that path is listed by its names
And choosing it brings back Enchakkal Supermarket in the drill pane
```

### Requirement: The drill pane's place is the user's choice

The drill pane SHALL find a sensible place for the window's size, and the user SHALL be able to
fix where it sits; that choice is remembered for them.

#### Scenario: The pane stays where the user put it

```gherkin
Given the user fixed the drill pane below the list
When the user signs in again and selects Enchakkal
Then the drill pane opens below the list
```

### Requirement: A row page shows its connections under its name

A row's page SHALL show the rows it points at and the counted groups that point at it directly
under the row's name, the same as the drill pane does, and opening one shows it in the drill pane.

#### Scenario: Enchakkal's page leads with its plants

```gherkin
Given the site Enchakkal has three plants
When the user opens Enchakkal's page
Then its region Kerala and a group of 3 plants show under its name
And opening the plants shows them in the drill pane
```

### Requirement: A row page has a form, a map and a tree

A row's page SHALL offer three ways to see the row: its form, a map of its links one step out in
both directions, and a tree. Switching between them SHALL keep the row in the centre and what the
user had expanded.

#### Scenario: Enchakkal's tree survives a look at the form

```gherkin
Given the user expanded Enchakkal's plants on its tree
When the user switches to the form and back to the tree
Then Enchakkal's plants are still expanded
```

### Requirement: The map shows a row without moving away from it

Clicking a row on the map SHALL show it in the drill pane while the map stays centred where it
was; the user can choose to centre the map on that row instead.

#### Scenario: Kerala in the pane, Enchakkal in the middle

```gherkin
Given the user is looking at Enchakkal's map
When the user clicks the region Kerala on the map
Then Kerala shows in the drill pane
And the map is still centred on Enchakkal
And choosing to centre on Kerala redraws the map around Kerala
```

### Requirement: The tree unfolds links in both directions

The tree SHALL show what the row links to above it and the groups that link to it below, each
unfolding in place several levels deep. A large group shows its first rows and offers the rest.

#### Scenario: From the site down to a cost centre

```gherkin
Given Enchakkal Supermarket has 40 profit centres
When the user unfolds Enchakkal's plants, then Enchakkal Supermarket's profit centres
Then the first 20 profit centres show, with a way to show all 40
And unfolding one profit centre shows its cost centres beneath it
```

### Requirement: Rows the user cannot read stay unnamed

The drill pane, the path, the map and the tree SHALL never show the name of a row the user is not
allowed to read, nor count it in a group.

#### Scenario: A plant the user may not read

```gherkin
Given the user may read sites but not one of Enchakkal's three plants
When the user opens Enchakkal in the drill pane and on its tree
Then the group of plants counts 2
And the name of the third plant shows nowhere
```
