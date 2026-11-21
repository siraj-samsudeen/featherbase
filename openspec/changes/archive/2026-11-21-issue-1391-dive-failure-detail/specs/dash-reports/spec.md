# Dash Reports

## MODIFIED Requirements

### Requirement: A report that can't open says so
A report whose Dive can't open SHALL say the report couldn't open, with a way to try again. When the reader's request gets no answer at all, because it failed on the way or ran out of time, Dash SHALL instead say it couldn't be reached and ask the reader to check their connection, with a way to try again. A report the reader can't open, or that doesn't exist, SHALL say they can't open it.

#### Scenario: An unknown report

- **WHEN** a reader with reports opens an address naming a report that doesn't exist
- **THEN** they are told they can't open this report, and their own reports stay listed

#### Scenario: The Dive can't be reached

- **WHEN** a Team Leader opens the sales report and MotherDuck refuses its Dive
- **THEN** the page says the report couldn't open and offers to try again, and shows no figures of its own

#### Scenario: The reader's connection drops

- **WHEN** the same Team Leader opens the sales report while their connection is down
- **THEN** the page says Dash couldn't be reached and to check their connection, offers to try again, and does not say the report couldn't open
