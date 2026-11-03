# List View

## MODIFIED Requirements

### Requirement: Narrow the list with filters

The user SHALL be able to add a filter on any column that holds a value, and every filter added SHALL narrow the list
further, apart from more choices ticked in one filter, which widen it; each filter in use is shown and can be removed
on its own.

#### Scenario: Add and remove a filter

- **WHEN** the user filters "Status" to "Open" in the list of "Section Mapping", and later removes that filter
- **THEN** only Open rows show while the filter is on, and removing it brings back every row

#### Scenario: Adding a filter on Status offers its choices

- **WHEN** the user adds a filter on Status in the list of "Section Mapping"
- **THEN** the user picks Open or Closed from its choices, without typing

#### Scenario: A filter on another column still narrows

- **WHEN** the user has Floor set to Ground and First Floor, and adds a filter on Status for Open
- **THEN** only Open rows on Ground or First Floor show

#### Scenario: Use a quick filter

- **WHEN** the user ticks "Closed" in the quick filter for Status, and later unticks it
- **THEN** only Closed rows show while "Closed" is ticked, with the filter shown as in use, and unticking it brings
  back every row

### Requirement: A quick filter suits its column

A quick filter SHALL match the kind of value in its column: words are searched, a column with set choices offers them
to tick, and a yes or no column offers yes or no to pick.

#### Scenario: Typing part of a word finds the Owner

- **WHEN** the user types "asha" in the quick filter for Owner
- **THEN** only rows whose Owner contains "asha" show

#### Scenario: A yes or no column offers yes and no

- **WHEN** the user picks yes in the quick filter for Active, and later picks no
- **THEN** only active rows show while yes is picked, and only inactive rows show while no is picked

## ADDED Requirements

### Requirement: Pick several choices in one filter

A filter on a column with set choices SHALL let the user tick one or more of them, and show the rows holding any of
them.

#### Scenario: Ground and First Floor rows both show

- **WHEN** the user adds a filter on Floor in the list of "Section Mapping" and ticks Ground and First Floor
- **THEN** rows on Ground and rows on First Floor show, and no others
- **AND** the filter in use names both floors

### Requirement: One filter per column with set choices

A column with set choices SHALL have at most one filter, and adding the same column again SHALL add to it, so ticking
choices one at a time gives the same rows as ticking them together.

#### Scenario: One Floor filter names both floors

- **WHEN** the user has filtered Floor to Ground, and adds another filter on Floor
- **THEN** Ground is already ticked, and ticking First Floor as well shows rows on Ground and on First Floor
- **AND** there is one filter in use naming both

#### Scenario: An older link's Floor filter takes more floors

- **WHEN** the user opens an older link, or a saved view, that filters Floor to Ground alone, and adds a filter on
  Floor with First Floor
- **THEN** rows on Ground and on First Floor show
- **AND** there is one filter in use naming both

#### Scenario: An older link that leaves out Ground shows the other floors ticked

- **WHEN** the user opens an older link, or a saved view, that filters Floor to anything but Ground
- **THEN** every row not on Ground shows, and the quick filter for Floor shows the other three floors ticked
- **AND** unticking Third Floor there leaves one filter in use, naming First Floor and Second Floor

#### Scenario: A link with two Floor filters shows as one

- **WHEN** the user opens a link that holds two separate filters on Floor, one for Ground and one for First Floor
- **THEN** rows on Ground and on First Floor show
- **AND** there is one filter in use naming both, and the quick filter for Floor shows both ticked

### Requirement: A quick filter is the same filter

The quick filter for a column with set choices SHALL always show the same choices as that column's filter in use, and
a change in either SHALL show at once in the other.

#### Scenario: The quick filter for Floor shows what was added

- **WHEN** the user adds a filter on Floor with Ground and First Floor
- **THEN** the quick filter for Floor shows Ground and First Floor ticked

#### Scenario: Unticking First Floor in the quick filter leaves Ground

- **WHEN** the user has Floor set to Ground and First Floor, and unticks First Floor in the quick filter for Floor
- **THEN** only Ground rows show, and the filter in use names only Ground

#### Scenario: Ticking every floor brings back every row

- **WHEN** the user ticks every floor in the quick filter for Floor
- **THEN** every row shows, and no Floor filter is in use

### Requirement: Tick every choice at once

The user SHALL be able to tick, or untick, every choice of a filter in one step.

#### Scenario: Every floor but Ground shows in two steps

- **WHEN** the user ticks every floor at once in the filter on Floor, then unticks Ground
- **THEN** every row not on Ground shows

### Requirement: Search a long list of choices

A column with more than eight choices SHALL let the user search its choices before ticking them, and ticking every
choice at once SHALL then tick only the ones found.

#### Scenario: Searching Section's choices ticks only the matches

- **WHEN** the user filters Section, which has twelve choices, unlike Floor's four, searches them for "rack" and ticks
  every choice found
- **THEN** only the sections with "rack" in their name are ticked, and only their rows show
