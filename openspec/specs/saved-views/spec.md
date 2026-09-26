# Saved Views

## Purpose

A saved view remembers a Table list's filters under a name, so the user —
or their team, if they choose to share it — can come back to that exact
narrowing without rebuilding it.

## Requirements

### Requirement: Save the current filters as a view

Saving the list's current filters under a name SHALL create a view that
appears on that table's list for reopening later.

#### Scenario: Save a filtered list

- **WHEN** the user filters "Status" to "Open" and saves it as "My open
  items"
- **THEN** "My open items" appears as a view on that table's list

### Requirement: Reopen a saved view

Opening a saved view SHALL apply its filters to the list, replacing
whatever filters are currently applied.

#### Scenario: Reopen a view

- **WHEN** the user opens "My open items" after filtering by something else
- **THEN** the list shows only what "My open items" filters for

### Requirement: A saved view is private unless its owner shares it

A saved view SHALL be visible only to the person who saved it until they
share it; sharing it makes it visible to everyone who can see that table's
list, and they can open it but not rename, unshare or delete it.

#### Scenario: A shared view is read-only to others

- **WHEN** a user shares "My open items" and a teammate opens it
- **THEN** the teammate can apply it, but has no way to rename, unshare or
  delete it

### Requirement: Changing a saved view means saving over it

A saved view SHALL NOT be edited or renamed in place; getting an updated
version means deleting it and saving a new one.

#### Scenario: Add a filter to a saved view

- **WHEN** the owner of "My open items" also wants it to require "Urgent"
- **THEN** they delete "My open items" and save a new view with both
  filters, since the original can't be changed directly

### Requirement: Featherbase offers to save a filter you keep reusing

Applying the same combination of filters several times in a week SHALL make
the list offer to save it as a view, right there, without the user going
looking for that option.

#### Scenario: The nudge appears

- **WHEN** the user applies the same two filters for the third time within
  a week
- **THEN** the list offers to save that combination as a view, which the
  user can accept or dismiss
