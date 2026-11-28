# Dash Reports

## MODIFIED Requirements

### Requirement: A Dive is sent only filters, never wider than the reader's reach
Dash SHALL send a Dive only the filters its report row names, filled from the reader's reach. When a report's shape can't express a reader's reach, Dash SHALL refuse to open it rather than send a wider filter.

#### Scenario: A whole-stores report for a section reader

- **WHEN** a Team Leader opens the whole-stores report from its address
- **THEN** the page says the report covers whole stores only, and nothing is sent to the Dive

### Requirement: A report that can't open says so
A report whose Dive can't open SHALL say the report couldn't open, with a way to try again. When the reader's request gets no answer at all, because it failed on the way or ran out of time, Dash SHALL instead say it couldn't be reached and ask the reader to check their connection, with a way to try again.

#### Scenario: An unknown report

- **WHEN** a reader with reports opens an address naming a report that doesn't exist
- **THEN** they are told they don't have this report, and their own reports stay listed

#### Scenario: The Dive can't be reached

- **WHEN** a Team Leader opens the sales report and MotherDuck refuses its Dive
- **THEN** the page says the report couldn't open and offers to try again, and shows no figures of its own

#### Scenario: The reader's connection drops

- **WHEN** the same Team Leader opens the sales report while their connection is down
- **THEN** the page says Dash couldn't be reached and to check their connection, offers to try again, and does not say the report couldn't open

## ADDED Requirements

### Requirement: A refused report says why
A report Dash refuses SHALL say why in plain words: the reader doesn't have it, nothing is set up for them yet, or the report isn't set up yet. Each refusal SHALL be recorded for whoever runs Dash, with the person, the report and the reason.

#### Scenario: Nothing set up for the reader yet

- **WHEN** a Department Manager whose department's sections aren't confirmed yet opens the sales report
- **THEN** the page says they have no stores or sections set up for this report yet and to ask their Store Manager to confirm their department's sections, and does not say the report couldn't open
