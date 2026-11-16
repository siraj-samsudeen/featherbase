## ADDED Requirements

### Requirement: The list remembers its last filters

A table's list SHALL remember the filters the user last left on it, for that user on that table and across sign-ins, beside its sort and columns. Opening the list with no filters in its address SHALL bring those filters back, shown in the address. Opening it through an address that names filters SHALL show exactly those and leave the remembered ones unchanged. A "Clear filters" control SHALL take every filter off, and the list then opens unfiltered.

#### Scenario: Come back to a filtered list

- **GIVEN** the user filtered the Department list to Store Attakulangara
- **WHEN** the user later opens the Department list from the sidebar
- **THEN** the list opens filtered to Store Attakulangara, with that filter shown

#### Scenario: A link's own filters win

- **GIVEN** the user left the Department list filtered to Store Attakulangara
- **WHEN** the user opens a link to the Department list filtered to Store Lakeside
- **THEN** the list shows Store Lakeside
- **AND** opening the list from the sidebar afterwards still shows Store Attakulangara

#### Scenario: Clear every filter

- **WHEN** the user chooses Clear filters on a filtered list
- **THEN** no filter is left on
- **AND** the list opens unfiltered next time
