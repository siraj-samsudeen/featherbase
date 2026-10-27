## MODIFIED Requirements

### Requirement: Check for problems before committing

The user SHALL be able to check a target's rows for problems before
importing it for real, seeing the same row-by-row outcome a real run would
report, with nothing written until the user imports for real. Each problem
SHALL name the column the user must fix, by the file's own header, and why.

#### Scenario: Rehearse before importing

- **WHEN** the user checks a target before importing it
- **THEN** it reports the same passes and problems a real import would
- **AND** nothing is written until the user imports for real

#### Scenario: A problem names the column to fix

- **WHEN** a checked row has a value its column refuses, such as a date written `23-10-2026`
- **THEN** the problem names that column, as the file's header writes it, and the reason
