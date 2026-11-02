## ADDED Requirements

### Requirement: Concurrent workflow actions have one winner

Concurrent actions from the same row state SHALL be judged against the state left by the preceding committed action. An action no longer available SHALL be refused without another approval record or notification.

#### Scenario: Two approvers act together

- **WHEN** two approvers approve the same pending request at the same time
- **THEN** only one approval succeeds and only one approval is recorded
- **AND** the other attempt is refused because approval is no longer available

#### Scenario: Competing branches

- **WHEN** two approvers choose different actions from the same pending state at the same time
- **THEN** only the first action succeeds and the other cannot overwrite its result
