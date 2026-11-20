# Dash Reports

## MODIFIED Requirements

### Requirement: A report that can't open says so
A report whose Dive can't open SHALL say the report couldn't open, with a way to try again. A report the reader can't open, or that doesn't exist, SHALL say they can't open it.

#### Scenario: An unknown report

- **WHEN** a reader with reports opens an address naming a report that doesn't exist
- **THEN** they are told they can't open this report, and their own reports stay listed

#### Scenario: The Dive can't be reached

- **WHEN** a Team Leader opens the sales report and MotherDuck refuses its Dive
- **THEN** the page says the report couldn't open and offers to try again, and shows no figures of its own

## ADDED Requirements

### Requirement: Every report opened is recorded
Each time a reader opens a report, Dash SHALL record it once in the Access Log, whichever report it is, so that who looked at reports, and when, can be answered. A report that is refused, or whose Dive can't open, SHALL NOT be recorded as opened.

#### Scenario: A Team Leader opens two reports

- **WHEN** a Team Leader opens the sales report, then the vendor report
- **THEN** the Access Log shows two openings by them

#### Scenario: A whole-stores report refused

- **WHEN** the same Team Leader opens the whole-stores report from its address
- **THEN** nothing is added to the Access Log
