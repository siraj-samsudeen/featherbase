## ADDED Requirements

### Requirement: Runs are listed by day

The list of a checklist's runs SHALL group them under the day they belong to, newest first, naming today and yesterday on the reader's own calendar and any older day in full.

#### Scenario: Early morning in India

- **WHEN** a user in India opens the run list at 02:00 and a run is dated today
- **THEN** it sits under Today, not Yesterday

#### Scenario: An older run

- **WHEN** a run is dated 05-Jan-2026 and that was more than a day ago
- **THEN** its heading reads 05-Jan-2026
