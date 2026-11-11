# Dash Reports

## MODIFIED Requirements

### Requirement: Reach follows the person's current job
A reader's reach SHALL come from their current job assignments: their section's subcategories for Staff and Team Leaders, their floor's sections for Floor Managers, the whole store for Store Managers, the stores of their cluster for Cluster Managers, and every store for directors. Head office staff SHALL reach nothing, unless they hold the Dash All-Stores Reader role.

#### Scenario: A Floor Manager

- **WHEN** a Floor Manager of Lakeside's first floor opens the sales report
- **THEN** they see the subcategories of that floor's sections at Lakeside, and nothing else

## ADDED Requirements

### Requirement: A role can reach every store
A person holding the Dash All-Stores Reader role SHALL reach every store, as a director's job does, in addition to whatever their jobs reach, and each store SHALL say "You see every store because you hold Dash All-Stores Reader". Holding the role alone SHALL open Dash. Once they reach stores, Dash SHALL NOT tell them their job is in head office or that they are not on the staff list.

#### Scenario: A head-office person given the role

- **WHEN** a head office person holding Dash All-Stores Reader opens the sales report
- **THEN** it opens with every store, and nothing says their job is in head office
