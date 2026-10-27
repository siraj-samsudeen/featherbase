## ADDED Requirements

### Requirement: A date and time reads on the viewer's own clock

A value that records a moment SHALL show its day and its time on the viewer's own clock, while a plain date SHALL show the day as it was entered, wherever the viewer is.

#### Scenario: An early-morning time in India

- **WHEN** a row records 02:00 on 21-Oct-2024 India time and a user in India looks at the list
- **THEN** it reads 21-Oct-2024 02:00, not the day before

#### Scenario: A plain date on another clock

- **WHEN** a row's date is 09-Mar-2026 and a user in New York looks at the list
- **THEN** it reads 09-Mar-2026
