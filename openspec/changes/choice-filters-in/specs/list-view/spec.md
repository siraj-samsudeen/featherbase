# List View

## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and every filter on a different column SHALL
narrow the list further; each filter in use is shown and can be removed on its own.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" in the list of "Section Mapping", and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it brings back every row

#### Scenario: Adding a filter on Status offers its choices

- **WHEN** the user adds a filter on Status in the list of "Section Mapping"
- **THEN** the user picks one or more of Open and Closed from its choices, without typing

#### Scenario: A filter on another column still narrows

- **WHEN** the user has Floor set to Ground and First Floor, and adds a filter on Status for Open
- **THEN** only Open rows on Ground or First Floor show

#### Scenario: Use a quick filter

- **WHEN** the user picks "Closed" in the quick filter for Status, and later picks "All"
- **THEN** only Closed rows show while "Closed" is picked, with the filter shown as in use, and picking "All" brings
  back every row

## ADDED Requirements

### Requirement: Pick several choices in one filter

A filter on a column with set choices SHALL let the user pick one or more of them, and show the rows holding any of
them, or the rows holding none of them.

#### Scenario: Ground and First Floor rows both show

- **WHEN** the user adds a filter on Floor in the list of "Section Mapping" and picks Ground and First Floor
- **THEN** rows on Ground and rows on First Floor show, and no others
- **AND** the filter in use names both floors

#### Scenario: Every floor but Ground shows

- **WHEN** the user adds a filter on Floor that leaves out Ground
- **THEN** every row not on Ground shows

### Requirement: One filter per column with set choices

A column with set choices SHALL have at most one filter, and adding the same column again SHALL add to it, so picking
choices one at a time gives the same rows as picking them together.

#### Scenario: One Floor filter names both floors

- **WHEN** the user has filtered Floor to Ground, and adds another filter on Floor with First Floor
- **THEN** rows on Ground and on First Floor show
- **AND** there is one filter in use naming both

#### Scenario: An older link's Floor filter takes more floors

- **WHEN** the user opens a link made before this change that filters Floor to Ground, and adds a filter on Floor with
  First Floor
- **THEN** rows on Ground and on First Floor show
- **AND** there is one filter in use naming both

### Requirement: A filter keeps whether it picks or leaves out

A filter on a column with set choices SHALL keep picking, or keep leaving out, until the user removes it.

#### Scenario: A Floor filter keeps its kind until it is removed

- **WHEN** the user has filtered Floor to Ground and adds another filter on Floor
- **THEN** the user can only add more floors to it, not leave floors out
- **AND** after removing the Floor filter, the user can add one that leaves floors out

### Requirement: A quick filter shows a filter with several choices

When a column's filter picks several choices, or leaves choices out, its quick filter SHALL say how many; picking a
choice in it SHALL replace that filter with the one choice.

#### Scenario: The quick filter for Floor says two are picked

- **WHEN** the user has a filter on Floor with Ground and First Floor
- **THEN** the quick filter for Floor says two are picked
- **AND** picking Second Floor in it shows only Second Floor rows

#### Scenario: The quick filter for Floor says one is left out

- **WHEN** the user has a filter on Floor that leaves out Ground
- **THEN** the quick filter for Floor says all but one
