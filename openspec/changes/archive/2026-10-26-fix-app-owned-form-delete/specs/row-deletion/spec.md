# Spec Delta

## ADDED Requirements

### Requirement: A late deletion of an app row is refused

If someone else has changed a row supplied by an installed app since the user opened it, deleting that row SHALL be refused rather than removing the newer version.

#### Scenario: Someone else changed the app row first

- **WHEN** the user tries to delete an installed app's row that another person changed after the user opened it
- **THEN** the deletion is refused
- **AND** the newer version remains unchanged
