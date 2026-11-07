## ADDED Requirements

### Requirement: A table names what narrows it

A table SHALL be able to name which of its references narrow its rows. Once it does, only those references narrow it. A table that names none is narrowed by every reference, as before.

#### Scenario: A supplier store does not hide a row

- **WHEN** a sections table is narrowed by its store alone, and a user narrowed to the North store opens it
- **THEN** they see North's sections, including one whose supplier store is South

### Requirement: A table can stay closed without narrowing

A table SHALL be able to require narrowing. Someone who has none on the references it names then sees none of its rows and can neither open, add, change nor delete any, and a row that names nothing on those references is closed to them too. This SHALL NOT apply to a System Manager.

#### Scenario: A store manager whose scope never arrived

- **WHEN** a store manager has no narrowing at all and opens a sections table that requires it
- **THEN** the list is empty, and opening, adding or changing a section is refused

#### Scenario: A section that names no store

- **WHEN** a store manager narrowed to the North store opens that table
- **THEN** they see North's sections, and not one that names no store
