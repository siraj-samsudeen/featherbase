# Dash People

## ADDED Requirements

### Requirement: Who administers which stores

In Dash a Store Manager SHALL administer their own store, a Cluster Manager
every store of the cluster they manage (each store's cluster comes from its
site), and a Chief Operating Officer or Director every store of the group.
Administering a store means keeping its floors, departments, sections, their
subcategories and display places, and the job assignments below Store Manager.

#### Scenario: A Cluster Manager reaches their cluster's stores

- **WHEN** a Cluster Manager manages the cluster whose sites hold stores A and B
- **THEN** they administer stores A and B and no other store

### Requirement: Who reads and edits employees and stints

Dash's HR role and System Managers SHALL edit employees and their stints. A
store administrator SHALL read the employees, and their stints, who currently
work in a store they administer, and no others. Nobody else SHALL read them.

#### Scenario: A Store Manager reads their own staff

- **WHEN** the Store Manager of store A lists employees
- **THEN** they see the people who work in store A today, and not someone who
  works only in store B
