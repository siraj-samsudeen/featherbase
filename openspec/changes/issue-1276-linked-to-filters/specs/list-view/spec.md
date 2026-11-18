## ADDED Requirements

### Requirement: A link cell offers Go there and Filter

Every link cell in a list's table SHALL offer, on hover or keyboard focus, Go there (open the
linked row's own page, as a step on the path) and Filter (narrow the list to rows linked to that
same row), the same two actions the record panel's link chips offer. A link to a row the viewer may
not read SHALL offer neither.

#### Scenario: Filter by a cell's vehicle

- **WHEN** the user hovers an accident's vehicle "Truck 2" and chooses Filter
- **THEN** the list shows only accidents of Truck 2, with the filter as a chip

#### Scenario: Go to a cell's vehicle

- **WHEN** the user hovers an accident's vehicle "Truck 2" and chooses Go there
- **THEN** Truck 2's own page opens, and Back returns to the list
