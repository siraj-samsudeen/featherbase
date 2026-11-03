## MODIFIED Requirements

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
