# Spec Delta

## ADDED Requirements

### Requirement: A deletion that arrives too late is refused

If someone else has changed a row since the user opened it, deleting that row SHALL be refused rather than removing the newer version.

#### Scenario: Someone else changed it first

- **WHEN** the user tries to delete a row that another person changed after the user opened it
- **THEN** the deletion is refused
- **AND** the newer version remains unchanged
