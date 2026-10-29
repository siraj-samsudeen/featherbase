## ADDED Requirements

### Requirement: Stored content cannot be claimed through a file edit

Uploading SHALL be the only way a user assigns stored content to a file. Creating a file by supplying a stored location, or editing it to claim a different one, SHALL be refused.

#### Scenario: Claim someone else's private upload

- **WHEN** the user creates another file referring to someone else's private upload
- **THEN** the save is refused and the original upload remains unchanged

#### Scenario: Replace an upload's stored content reference

- **WHEN** the user edits a file to refer to a different upload's stored content
- **THEN** the save is refused and both uploads remain unchanged
