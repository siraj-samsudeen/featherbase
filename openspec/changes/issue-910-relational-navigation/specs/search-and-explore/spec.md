# Search and Explore

## REMOVED Requirements

### Requirement: The relationship map shows one row's neighborhood

**Reason**: The map moves onto the row's page, next to its form and tree, and clicking on it shows
a row in the drill pane rather than moving the map.
**Migration**: relational-navigation's "A row page has a form, a map and a tree" and "The map shows
a row without moving away from it".

### Requirement: The relationship map remembers the trail

**Reason**: The path replaces the map's own trail, and covers lists, the drill pane and row pages
alike.
**Migration**: relational-navigation's "The path remembers every step".
