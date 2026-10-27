## ADDED Requirements

### Requirement: A scheduled report holds what its setter could see

A scheduled report email SHALL carry the report's rows and columns exactly as the person who set up the schedule could see them, every one of them however long the report is, and SHALL send nothing once that person is disabled or can no longer read the report.

#### Scenario: A setter limited to their own rows

- **WHEN** a person who may see only the rows they created schedules a report over a table that also holds other people's rows
- **THEN** the recipients get only that person's rows

#### Scenario: The setter has left

- **WHEN** the person who set up a schedule is disabled before its next send
- **THEN** nothing is sent for it, and every other schedule that is due still goes

#### Scenario: A long report

- **WHEN** a scheduled report has six hundred rows
- **THEN** the attachment holds all six hundred and the email says so
