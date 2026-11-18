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

### Requirement: A link reads by its name, with its code where that helps

Every link to another row, in a list, the drill pane, the tree or the path, SHALL read by that
row's name. Where the row is known by a code people use, the code follows the name; an id the
system made up never shows.

#### Scenario: Enchakkal's supermarket reads with its plant code

```gherkin
Given the plant Enchakkal Supermarket has the plant code 1503
When the user opens the list of profit centres
Then each profit centre's plant reads "Enchakkal Supermarket · 1503"
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

### Requirement: Two links from the same table stay separate groups

When one table links to the row in two ways, the drill pane SHALL show each way as its own group
with its own count, and a group with no rows stays listed, quieter than the rest.

#### Scenario: Supplying and billing plants

```gherkin
Given each cost centre names a supplying plant and a billing plant
And Enchakkal Supermarket supplies 8 cost centres and bills none
When the user opens Enchakkal Supermarket in the drill pane
Then a group of 8 cost centres by supplying plant shows
And a group of 0 cost centres by billing plant shows, quieter than the other
```

### Requirement: A group lists its rows by what they point to

A group in the drill pane and on the tree SHALL list its rows one per line. A row of a link table
(its title is its own id) reads by its far sides: its readable links, other than the link back and
those to the row's own linked records, one per Table. Two or more read as the first two, joined by
" › ". Any other row reads by its own name. Up to two dates and statuses show beneath. The first
10 rows show, then "Show all N".

#### Scenario: Enchakkal's plants by their names

```gherkin
Given the user has Enchakkal open in the drill pane
When the user opens its group of plants
Then the 3 plants show one per line, each by its name
```

#### Scenario: A section's job assignments read as its employees

```gherkin
Given a section has job assignments, each linking the section to an employee
When the user opens the section's job assignments in the drill pane
Then each line is the employee's name, a link to the employee
```

### Requirement: A group can be opened as its own list

The user SHALL be able to open a group in the drill pane as a full list of that table, narrowed to
the rows that point at the row in the pane.

#### Scenario: Enchakkal's plants as a list

```gherkin
Given the user has Enchakkal open in the drill pane
When the user opens its group of plants as a list
Then the list of plants opens, narrowed to the 3 plants of Enchakkal
```

### Requirement: A new row from a group starts linked to the row

From a group opened as a list, a new row SHALL start already linked to the row in the pane, and
no new row is offered to a user who may not add rows to that table.

#### Scenario: A new plant for Enchakkal

```gherkin
Given the user may add plants and has Enchakkal's plants open as a list
When the user starts a new plant
Then the new plant's site is already Enchakkal
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

The fields follow the arrangement the user chose for the row's form.

#### Scenario: Enchakkal's fields at a glance

```gherkin
Given the site Enchakkal has a long note and two empty fields
When the user reads Enchakkal's fields in the drill pane
Then the note is shortened with a way to read all of it
And the two empty fields are folded away under a count
And the user can open Enchakkal's form to edit it
```

### Requirement: The path remembers every step

Every drill and every filter SHALL become a step on a path, named after the rows and values it
shows. Choosing an earlier step SHALL bring back what was on screen at that step.

#### Scenario: Back to the site from its supermarket

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
groups.

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

### Requirement: A row page shows its connections under its name

A row's page SHALL show the rows it points at and the counted groups that point at it directly
under the row's name, the same as the drill pane does. Opening a row it points at shows it in the
drill pane; opening a group jumps to that group's section on the row's Links tab.

#### Scenario: Enchakkal's page leads with its plants

```gherkin
Given the site Enchakkal has three plants
When the user opens Enchakkal's page
Then its region Kerala and a group of 3 plants show under its name
And opening the plants shows them in their section on the Links tab
```

### Requirement: A row page has a form, links, a map and activity

A row's page SHALL offer four tabs: Form, Links, Map and Activity, and SHALL open on Form. Links
shows the row's fields beside one section per group that points at it; its View menu shows them as
the tree instead, and that choice SHALL be remembered for the person and the Table. Activity holds
the row's history and discussion, and its people, tags and files. Switching between tabs SHALL keep
the row in the centre and what the user had expanded.

#### Scenario: Enchakkal's page opens on its form

```gherkin
Given the user has never opened a site's Links as the tree
When the user opens Enchakkal's page
Then its tabs are Form, Links, Map and Activity, and Form is open
When the user shows Enchakkal's links as the tree and opens another site's Links tab
Then that site's links show as the tree too
```

#### Scenario: Enchakkal's tree survives a look at the form

```gherkin
Given the user expanded Enchakkal's plants on its tree
When the user switches to the form and back to the tree
Then Enchakkal's plants are still expanded
```

### Requirement: The tree shows a row without moving away from it

Clicking a row on the tree SHALL show it in the drill pane while the tree stays centred where it
was.

#### Scenario: A cost centre from the tree

```gherkin
Given the user unfolded Enchakkal's tree down to the cost centre EKL-Marketing
When the user clicks EKL-Marketing on the tree
Then EKL-Marketing shows in the drill pane
And the tree is still centred on Enchakkal
```

### Requirement: The map can be walked, one record at a time

A row's map SHALL show that one row in the middle, the rows it points to on the left, and on the
right one box per group that points at it, with the group's count and its first 4 rows by name,
then how many more the drill pane holds. An empty group SHALL stay, greyed. Each row the user may
open SHALL read as a link with Focus beside it; clicking it, or its Focus, SHALL centre the map on
that row and add it to the path, so the user can walk back along the path.

#### Scenario: Enchakkal's map lists its plants

```gherkin
Given the site Enchakkal has three plants
When the user opens Enchakkal's map
Then the region Kerala shows on its left
And the plants' box lists Enchakkal's three plants by name, each with Focus
```

#### Scenario: The first 4 of 40 profit centres on the map

```gherkin
Given Enchakkal Supermarket has 40 profit centres
When the user opens Enchakkal Supermarket's map
Then the profit centres' box lists 4 of them and says 36 more are in the panel
And clicking that shows the profit centres in the drill pane
```

#### Scenario: From Enchakkal to Kerala and back on the map

```gherkin
Given the user is looking at Enchakkal's map
When the user clicks the region Kerala on the map
Then the map is centred on Kerala and the path ends at Kerala
When the user goes back to Enchakkal on the path
Then the map is centred on Enchakkal again
```

### Requirement: A group on the map is named from the row's side

A group on the map SHALL be named by its Table, the link that joins it and the row's name, so it
reads how its rows relate to the row. A group of rows that only link the row to one other Table
SHALL be named by that Table, through the group.

#### Scenario: The plants whose site is Enchakkal

```gherkin
Given the site Enchakkal has three plants
When the user opens Enchakkal's map
Then the plants' box is named "Plant · Site Enchakkal" with its count 3
```

### Requirement: The map explains a record where an app declares how

The map SHALL offer Why beside Neighbours only for a record of a Table that an installed app
declares, and only when the server, asking that app's own read, says the viewer may have this record
explained. Neighbours SHALL stay the default. Why SHALL draw the app's answer in columns, and
clicking a box SHALL light every chain that leads to it, back to the first column.

#### Scenario: Why a floor manager reads Dash

```gherkin
Given an installed app explains a floor manager's access, and lets the user see it
When the user opens her map and chooses Why: Access
Then the app's columns show, and Floor Manager says HR and Buyer says by hand
When the user clicks Dash · Reader
Then every chain that leads to it lights up, back to her
```

#### Scenario: No Why for someone the app does not let see it

```gherkin
Given an installed app explains a floor manager's access, but not to the user
When the user opens her map
Then the map shows her neighbours with no Why to choose
```

### Requirement: An app's explanation only reads, and is checked before it is drawn

An app SHALL declare a Why by two of its reads, never its actions, and the platform SHALL refuse it
at install otherwise. The platform SHALL check every explanation against one versioned shape before
the map draws it, refusing a malformed one whole, and SHALL name no record in it that the viewer may
not read.

#### Scenario: A broken explanation

```gherkin
Given an app's explanation of a record joins a box to one that is not there
When the user chooses Why on that record's map
Then the map says it can't explain this right now, and draws none of it
```

### Requirement: The tree unfolds links in both directions

The tree SHALL show what the row links to above it and the groups that link to it below, each
unfolding in place several levels deep.

#### Scenario: From the site down to a cost centre

```gherkin
Given Enchakkal Supermarket is one of Enchakkal's plants
When the user unfolds Enchakkal's plants, then Enchakkal Supermarket's profit centres, then EKL - Retail (All)
Then the cost centres of EKL - Retail (All) show beneath it
And the region Kerala shows above Enchakkal
```

### Requirement: A large group on the tree shows its first rows

A large group on the tree SHALL show its first 10 rows and offer the rest, so unfolding it never
floods the view.

#### Scenario: The first 10 of 40 profit centres

```gherkin
Given Enchakkal Supermarket has 40 profit centres
When the user unfolds them on the tree
Then the first 10 profit centres show, with a way to show all 40
```

### Requirement: Rows the user cannot read stay unnamed

The drill pane, the path, the map and the tree SHALL never show the name of a row the user is not
allowed to read, nor count it in a group.

#### Scenario: A plant the user may not read

```gherkin
Given the user may read sites but not one of Enchakkal's three plants
When the user opens Enchakkal in the drill pane, on its tree and on its map
Then the group of plants counts 2
And the name of the third plant shows nowhere
```

### Requirement: A relationship the user may change is a tick list

A group of rows that only link the row to one other Table SHALL read as a tick list where the user
may both add and delete that group's rows and the other Table has 40 rows or fewer. Its header
names the other Table and how many of its rows are ticked ("Business Roles 2 of 7"); it lists
every one of them, ticked ones first with their area and end date, unticked ones greyed. Anywhere
else the group lists its rows as before. A long list folds after ten.

#### Scenario: A member's roles as ticks

```gherkin
Given a member holds two of seven roles, and the user may add and remove roles
When the user opens the member's Links tab
Then the roles read "2 of 7", the two held first, each with its area and end date
And the five others follow, greyed
```

#### Scenario: Someone who may not change roles reads them as a list

```gherkin
Given a member holds two of seven roles, and the user may only read them
When the user opens the member's Links tab
Then the roles held show as a list, with no tick
```

### Requirement: Every ticked link says where it came from

A ticked link SHALL carry a source chip: "from" the name of the feed, platform step or import that
wrote it, or "given by hand". A link from a feed SHALL be locked: its tick is tinted and cannot be
unticked, and Correct shows beside it only where its Table names where corrections are made.

#### Scenario: A role from the HR feed is locked

```gherkin
Given the HR feed gave a member the role Floor Lead, and the roles' Table says where to correct them
When the user opens the member's Links tab
Then Floor Lead reads "from HR" with a locked tick and Correct beside it
And a role given by hand reads "given by hand" and can be unticked
```

### Requirement: Ticking asks first, unticking removes

Ticking an unticked choice SHALL open a form under it asking for the link's own fields (its area,
an end date, a reason); nothing SHALL be saved until Add. Unticking a link given by hand SHALL
remove it, and the save state SHALL say it is saved.

#### Scenario: Also give Team Leader

```gherkin
Given a member does not hold the role Team Leader
When the user ticks Team Leader
Then a form asks for its area, end date and reason, and nothing is saved yet
When the user fills in the reason and adds it
Then the member holds Team Leader, given by hand
```

#### Scenario: Untick a role given by hand

```gherkin
Given a member was given the role Buyer by hand
When the user unticks Buyer
Then the member no longer holds Buyer, and the page says it is saved
```

### Requirement: An empty group stays, greyed, and offers a new row

A group with no rows SHALL still show, greyed, and offer + New, which opens a new row already
linked to the row, to a user who may add rows to its Table.

#### Scenario: A first note for a member

```gherkin
Given a member has no notes, and the user may add notes
When the user opens the member's Links tab
Then the notes group shows greyed with + New
And + New opens a new note already linked to the member
```

### Requirement: Open as grid only for small pairs

A group's header SHALL offer Open as grid only where the row's own Table and the other Table each
have about 40 rows or fewer. Until the grid comes, it opens the group's list.

#### Scenario: Roles of a small team

```gherkin
Given a team of members and a set of roles, each 40 or fewer
When the user opens a member's Links tab
Then the roles' header offers Open as grid
When the team grows past 40
Then the roles' header no longer offers it
```
