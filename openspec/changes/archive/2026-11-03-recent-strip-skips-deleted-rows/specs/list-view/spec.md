## MODIFIED Requirements

### Requirement: The list offers what the user recently opened from it

Above a table's list, the user SHALL see the rows and filter combinations
they most recently opened from that table, each reachable in one click. The
trail is private to them. Only rows that still exist, and that the user can
read, are offered.

#### Scenario: Return to a recent filter

- **WHEN** the user filtered the table by "note = searchable", opened a row,
  and later comes back to the table's list
- **THEN** that row and that filter appear as recent, and clicking the filter
  applies it again

#### Scenario: A deleted row is no longer offered

- **WHEN** the user opened the rows "Aisle bin" and "Corner bin", deleted
  "Corner bin", and comes back to the table's list
- **THEN** "Aisle bin" appears as recent and "Corner bin" does not
