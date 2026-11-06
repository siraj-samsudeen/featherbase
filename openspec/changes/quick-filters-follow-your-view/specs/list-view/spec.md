# List View

## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and every filter added SHALL narrow the list
further; each filter in use is shown and can be removed on its own.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" in the list of "Section Mapping", and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it brings back every row

#### Scenario: Adding a filter on Status offers its choices

- **WHEN** the user adds a filter on Status in the list of "Section Mapping"
- **THEN** the user picks Open or Closed from its choices, without typing

#### Scenario: Use a quick filter

- **WHEN** the user picks "Closed" in the quick filter for Status, and later picks "All"
- **THEN** only Closed rows show while "Closed" is picked, with the filter shown as in use, and picking "All" brings
  back every row

## ADDED Requirements

### Requirement: Quick filters follow the columns you see

A quick filter is a box above the list for narrowing it in one step. Each column in the user's own view SHALL have one
if its kind of value can take one, in the same order as the list's columns.

#### Scenario: Remarks gets a quick filter when it is switched on

- **WHEN** the user switches on Remarks in the list of "Section Mapping"
- **THEN** a quick filter for Remarks appears, in Remarks' place among the columns

#### Scenario: Floor's quick filter goes when Floor is switched off

- **WHEN** the user switches off Floor in the list of "Section Mapping"
- **THEN** the quick filter for Floor is gone

#### Scenario: A filter on a hidden column stays on

- **WHEN** the user has filtered Floor to "Ground" and then switches off Floor
- **THEN** the list still shows only Ground rows
- **AND** the filter still shows as in use, and removing it brings every row back

#### Scenario: A date column has no quick filter

- **WHEN** the user's view of "Section Mapping" shows its Audited On date
- **THEN** there is no quick filter for Audited On
- **AND** the user can still add a filter on it

### Requirement: A quick filter suits its column

A quick filter SHALL match the kind of value in its column: words are searched, and a column with set choices or a
yes or no answer offers those to pick from.

#### Scenario: Typing part of a word finds the Owner

- **WHEN** the user types "asha" in the quick filter for Owner
- **THEN** only rows whose Owner contains "asha" show

#### Scenario: A yes or no column offers yes and no

- **WHEN** the user picks yes in the quick filter for Active, and later picks no
- **THEN** only active rows show while yes is picked, and only inactive rows show while no is picked

### Requirement: Filtering a yes or no column finds its rows

A filter on a yes or no column SHALL match by yes or no however it was added, and the user picks yes or no rather than
typing it. A value that is neither SHALL find no rows, as an unknown choice does.

#### Scenario: An added filter on Active finds the active rows

- **WHEN** the user adds a filter on Active and picks yes
- **THEN** only active rows show
- **AND** the filter in use reads yes

#### Scenario: A link changed by hand to say Active is true finds the active rows

- **WHEN** someone has changed a link to the list of "Section Mapping" by hand so its filter says Active is "true", and
  the user opens that link
- **THEN** only active rows show

#### Scenario: A link changed by hand to say Active is maybe finds no rows

- **WHEN** someone has changed a link to the list of "Section Mapping" by hand so its filter says Active is "maybe", and
  the user opens that link
- **THEN** no rows show, as for a Status that doesn't exist

### Requirement: Many quick filters stay out of the way

The list SHALL show up to six quick filters, and say how many more there are, which open in place on request. A quick
filter holding a value SHALL never fold away, even if that means showing more than six.

#### Scenario: Six quick filters show and two more wait

- **WHEN** the user's view of "Section Mapping" has eight columns that can take a quick filter, and the user opens the
  list
- **THEN** six quick filters show, and the list says there are 2 more
- **AND** asking to see them shows all eight without leaving the list

#### Scenario: The eighth quick filter stays showing while it holds a value

- **WHEN** the user's view of "Section Mapping" has eight columns that can take a quick filter, and the user opens a
  link with a value in the eighth
- **THEN** the first six quick filters show, and so does the eighth, holding that value
- **AND** the list says there is 1 more
