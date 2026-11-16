# Saved Views

## Purpose

A saved view remembers a Table list's filters under a name, so the user —
or their team, if they choose to share it — can come back to that exact
narrowing without rebuilding it.

## Requirements

### Requirement: Save the current filters as a view

Saving the list's current filters under a name SHALL create a view that
appears on that table's list for reopening later. The user SHALL be able to
save filters on first use without waiting for a repeated-use suggestion.

#### Scenario: Save a filtered list

- **WHEN** the user filters "Status" to "Open" and saves it as "My open
  items"
- **THEN** "My open items" appears as a view on that table's list

#### Scenario: Save on first use

- **WHEN** the user applies a filter they have never used before
- **THEN** they can save it as a named view immediately

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

#### Scenario: A private view stays private

- **WHEN** a user saves "My open items" and does not share it
- **THEN** a teammate does not see it on that table's list

#### Scenario: The owner takes a share back

- **WHEN** the owner of a shared view makes it private again
- **THEN** teammates no longer see it, and the owner still does

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

#### Scenario: Decline the offer

- **WHEN** the user declines the offer for a combination of filters
- **THEN** the offer does not come back for that combination

### Requirement: Saved views are in the Admin sidebar

The Admin sidebar SHALL list, under "Saved views", the user's own saved views on every table and the shared views of others that the user starred. Only views on tables the user can read now SHALL be listed. Choosing one SHALL open its table's list with the view's filters. A shared view of someone else SHALL offer a star on the list to add it to the sidebar or remove it; the user's own views need none. With nothing to list, the group SHALL NOT be shown.

#### Scenario: Find a saved view from the sidebar

- **GIVEN** the user saved the view "ATK Departments" on Department
- **WHEN** the user chooses "ATK Departments" in the sidebar's Saved views
- **THEN** the Department list opens with that view's filters

#### Scenario: Star a colleague's shared view

- **GIVEN** a colleague shared the view "ATK Departments" on Department, which the user can read
- **WHEN** the user stars it on the Department list
- **THEN** it appears in the user's sidebar, marked as shared
- **AND** unstarring it takes it out

#### Scenario: Nothing the user cannot read

- **GIVEN** the user starred a shared view on a table they cannot read, or one later made private or deleted
- **WHEN** the sidebar lists the user's saved views
- **THEN** that view is not listed
