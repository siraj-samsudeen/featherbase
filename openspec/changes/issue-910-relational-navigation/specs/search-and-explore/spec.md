# Search and Explore

## MODIFIED Requirements

### Requirement: Explore chains tables and narrows them as you click

Explore SHALL let the user start from a Table and add up to two more, each
connected to the one before by a reference or a child relationship. Clicking
rows in one selects them, narrowing every table after it to what relates to
that selection, with an exact count and sum; with nothing selected, a table
follows everything related to what's above it. Opening a row from Explore
SHALL show it in the drill pane, rather than leaving Explore.

#### Scenario: Narrow by clicking

```gherkin
Given the user starts Explore from Supplier and adds Purchase Order
When the user clicks one supplier and then adds PO Line
Then Purchase Order narrows to that supplier's orders
And PO Line narrows to those orders' lines, with an accurate count and sum at every stage
```

#### Scenario: Open a row without leaving Explore

```gherkin
Given the user has Explore narrowed to one supplier's orders
When the user opens one of those orders
Then it shows in the drill pane
And the supplier stays selected in Explore
```

### Requirement: The relationship map shows one row's neighborhood

A row's page SHALL offer a relationship map: what the row points to and what points back to it,
one step out in each direction, with a count for each group.

#### Scenario: Enchakkal's map

```gherkin
Given the site Enchakkal is in region Kerala and has three plants
When the user opens the map on Enchakkal's page
Then the map shows Enchakkal pointing at Kerala
And a group of 3 plants pointing back at Enchakkal
```

#### Scenario: Jump to a related row

```gherkin
Given the user is looking at Enchakkal's map
When the user chooses to centre the map on the region Kerala
Then the map re-centres on Kerala, showing what it in turn points to and back from
```

## REMOVED Requirements

### Requirement: The relationship map remembers the trail

**Reason**: The path replaces the map's own trail, and covers lists, the drill pane and row pages
alike.
**Migration**: relational-navigation's "The path remembers every step".

### Requirement: The relationship map lists its center row until a collection is opened

**Reason**: The drill pane shows the centre row's fields and opens its groups, so the map no longer
keeps a list of its own.
**Migration**: relational-navigation's "Read a row's fields in the pane" and "A group lists its
rows like the table's own list".

### Requirement: A link in the relationship map's row lists reads by its title

**Reason**: The map no longer has row lists; every link everywhere reads by its name.
**Migration**: relational-navigation's "A link reads by its name, with its code where that helps".
