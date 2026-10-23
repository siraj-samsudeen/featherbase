# Sales Target Report Delta

## ADDED Requirements

### Requirement: Every listed group is named from the hierarchy

The report SHALL name each material group in the reader's list from the merchandise hierarchy, whether or not the group has a target this month.

#### Scenario: A group with no target this month

- **WHEN** a reader's Section lists a group that has no target this month
- **THEN** the group shows its hierarchy name, never "(name not in hierarchy)"

### Requirement: Every sale counts, target or not

The report SHALL show each group's sales for the store and the month to date from all sales, and SHALL read a ₹0 target where none was set. A group that has a target SHALL show the same actual as the target rows carry.

#### Scenario: A group that sold with no target

- **WHEN** a group with no target sold ₹1,200 this month at the reader's store
- **THEN** the group shows ₹0 target and ₹1,200 actual, and its Section subtotal includes the ₹1,200

### Requirement: Groups with no target and no sale are hidden by default

A group with ₹0 target and ₹0 sales this month SHALL be hidden by default. The report SHALL offer a "Show groups with no target or sales" toggle that names how many there are and shows them when turned on. Each Section subtotal and the report total SHALL be the sum of the Section's rows, hidden or shown.

#### Scenario: A Food Court Section that lists every Food Court group

- **WHEN** a reader's Section lists 120 groups and the store traded 20 of them this month
- **THEN** the 20 are shown, the other 100 are hidden behind the toggle, and the Section subtotal is the same with the toggle on or off
