## ADDED Requirements

### Requirement: A row linked from any table shows what links to it

A row's connections SHALL include the rows that link to it through a link to any table, counted, and SHALL open exactly those rows. This SHALL hold whether the link sits on a row or on one of its nested rows. A table the viewer can't see SHALL be left out.

#### Scenario: Two decisions about a plant

- **WHEN** two decisions link to plant 8151 and the user opens the plant's connections
- **THEN** they show 2 decisions, and opening them lists those two decisions

#### Scenario: A plan whose step is about the plant

- **WHEN** a plan's nested step links to plant 8151
- **THEN** the plant's connections show the plan, and opening them lists that plan only

### Requirement: Nested rows can link to a row of any table

A nested row SHALL be able to hold a link to a row of any table, chosen as on a form: the table first, from the tables the column allows, then the row by its name.

#### Scenario: A step about a plant

- **WHEN** the user adds a step to a plan, picks the plant table and then plant Palakkad, and saves
- **THEN** the step is saved linking to plant 8151
