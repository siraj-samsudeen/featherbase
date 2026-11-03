## ADDED Requirements

### Requirement: Recent visits do not crowd out frequent destinations

The user's navigation SHALL offer frequently used destinations alongside
recent ones when there are frequent destinations not already shown.

#### Scenario: Many recent visits

- **WHEN** the user visits several new destinations after repeatedly using
  an older destination
- **THEN** the older destination remains available among frequently used
  destinations without repeating one already shown as recent

### Requirement: Open the last related row in place

Selecting a row at the end of an Explore chain SHALL open its details in
place without changing the selections that narrowed the chain.

#### Scenario: Inspect the last pane

- **WHEN** the user follows a supplier to its orders and then their items,
  and selects one of the items
- **THEN** the item's details open without leaving Explore
- **AND** closing the details leaves the supplier and order selections intact
