## ADDED Requirements

### Requirement: A role that may only create rows keeps what it typed

A new row SHALL keep every column its creator filled in that their role's
create or edit access reaches. A role allowed to create rows but not to
edit them SHALL therefore save a new row with what was typed, and cannot
change it afterwards.

#### Scenario: Create without edit

- **WHEN** a user whose role may create orders but not edit them saves a new
  order titled "Planner order"
- **THEN** the order is saved with that title
- **AND** a later change to it is refused
